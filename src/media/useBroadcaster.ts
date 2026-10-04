import { useCallback, useEffect, useRef, useState } from 'react';
import type { CameraSource } from '../shared/types';
import { socket } from '../socket';
import { iceServers } from './ice';

export type BroadcasterStatus = 'idle' | 'requesting' | 'connecting' | 'ready' | 'reconnecting' | 'error';

export interface BroadcasterOptions {
  source: CameraSource;
  token?: string;
}

interface JoinAck {
  ok: boolean;
  source?: CameraSource;
  error?: string;
}

interface WatcherMessage {
  source: CameraSource;
  peerId: string;
  kind: 'video' | 'audio';
}

interface SignalMessage {
  source: CameraSource;
  from: string;
  kind: 'video' | 'audio';
  data:
    | { type: 'offer'; sdp: string }
    | { type: 'answer'; sdp: string }
    | { type: 'candidate'; candidate: RTCIceCandidateInit };
}

interface PeerLeftMessage {
  source: CameraSource;
  peerId: string;
  kind?: 'video' | 'audio';
}

function errorMessage(failure: unknown): string {
  const error = failure as DOMException | Error | undefined;
  if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError') {
    return 'Camera or microphone permission was denied. Allow access in your browser settings, then try again.';
  }
  if (error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError') {
    return 'No camera or microphone was found on this device.';
  }
  if (error?.name === 'NotReadableError' || error?.name === 'TrackStartError') {
    return 'The camera or microphone is already in use by another app.';
  }
  if (error?.name === 'OverconstrainedError') {
    return 'The camera or microphone could not start with the requested settings.';
  }
  return error?.message || 'The camera or microphone could not start. Check browser permissions and try again.';
}

export function useBroadcaster() {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<BroadcasterStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const optionsRef = useRef<BroadcasterOptions | null>(null);
  const peersRef = useRef(new Map<string, { peerId: string; kind: 'video' | 'audio'; peer: RTCPeerConnection; pendingCandidates: RTCIceCandidateInit[] }>());
  const operationRef = useRef(0);
  const joinedRef = useRef<{ socketId: string; source: CameraSource } | null>(null);
  const joiningRef = useRef<Promise<void> | null>(null);

  const closePeer = useCallback((peerId: string, kind?: 'video' | 'audio') => {
    for (const [key, record] of peersRef.current) {
      if (record.peerId !== peerId || (kind && record.kind !== kind)) continue;
      peersRef.current.delete(key);
      record.peer.onicecandidate = null;
      record.peer.onconnectionstatechange = null;
      record.peer.close();
    }
  }, []);

  const closeAllPeers = useCallback(() => {
    const peers = [...peersRef.current.values()];
    peersRef.current.clear();
    for (const record of peers) {
      record.peer.onicecandidate = null;
      record.peer.onconnectionstatechange = null;
      record.peer.close();
    }
  }, []);

  const join = useCallback(async () => {
    const options = optionsRef.current;
    const stream = streamRef.current;
    if (!options || !stream) return;
    if (!socket.connected || !socket.id) throw new Error('Signaling server is disconnected. Check the network and retry.');

    const socketId = socket.id;
    if (joinedRef.current?.socketId === socketId && joinedRef.current.source === options.source) {
      setStatus('ready');
      setError(null);
      return;
    }
    if (joiningRef.current) return joiningRef.current;

    const joinPromise = new Promise<void>((resolve, reject) => {
      const ack = (timeout: Error | null, response?: JoinAck) => {
        if (timeout) {
          reject(new Error('The signaling server did not respond. Check the network and try again.'));
        } else if (!response?.ok) {
          reject(new Error(response?.error || 'The input link could not be verified. Ask the director for a new link.'));
        } else {
          if (optionsRef.current?.source === options.source && streamRef.current === stream && socket.id === socketId) {
            joinedRef.current = { socketId, source: options.source };
          }
          resolve();
        }
      };

      if (options.source === 'director') {
        socket.timeout(8000).emit('input:join-director', { source: options.source }, ack);
      } else if (options.token) {
        socket.timeout(8000).emit('input:join', { source: options.source, token: options.token }, ack);
      } else {
        reject(new Error('This phone link is missing its private invite token. Ask the director for a new link.'));
      }
    });

    joiningRef.current = joinPromise;
    setStatus('connecting');
    try {
      await joinPromise;
      if (optionsRef.current?.source === options.source && streamRef.current === stream && socket.id === socketId) {
        setStatus('ready');
        setError(null);
      }
    } finally {
      if (joiningRef.current === joinPromise) joiningRef.current = null;
    }
  }, []);

  const waitForSocket = useCallback(() => {
    if (socket.connected) return Promise.resolve();

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const cleanUp = () => {
        clearTimeout(timer);
        socket.off('connect', onConnect);
        socket.off('connect_error', onConnectError);
      };
      const finish = (failure?: Error) => {
        if (settled) return;
        settled = true;
        cleanUp();
        if (failure) reject(failure);
        else resolve();
      };
      const onConnect = () => finish();
      const onConnectError = () => finish(new Error('Could not reach the signaling server. Check the network and try again.'));
      const timer = setTimeout(() => finish(new Error('Timed out connecting to the signaling server. Check the network and try again.')), 10000);

      socket.once('connect', onConnect);
      socket.once('connect_error', onConnectError);
      if (!socket.connected) socket.connect();
      else finish();
    });
  }, []);

  const sendSignal = useCallback((peerId: string, source: CameraSource, kind: 'video' | 'audio', data: SignalMessage['data']) => {
    if (socket.connected) socket.emit('input:signal', { to: peerId, source, kind, data });
  }, []);

  const createPeer = useCallback(async ({ source, peerId, kind }: WatcherMessage) => {
    const stream = streamRef.current;
    if (!stream || !socket.connected) return;
    closePeer(peerId, kind);

    const peer = new RTCPeerConnection({ iceServers });
    const key = `${peerId}:${kind}`;
    const record = { peerId, kind, peer, pendingCandidates: [] as RTCIceCandidateInit[] };
    peersRef.current.set(key, record);
    const tracks = kind === 'audio' ? stream.getAudioTracks() : stream.getTracks();
    for (const track of tracks) peer.addTrack(track, stream);

    peer.onicecandidate = event => {
      if (event.candidate) {
        sendSignal(peerId, source, kind, { type: 'candidate', candidate: event.candidate.toJSON() });
      }
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'failed') {
        closePeer(peerId, kind);
        setError('A camera connection failed. Check the network; restrictive networks may need a TURN relay.');
      } else if (peer.connectionState === 'closed') {
        closePeer(peerId, kind);
      }
    };

    try {
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      if (peer.connectionState === 'closed' || peersRef.current.get(key)?.peer !== peer) return;
      const sdp = peer.localDescription?.sdp;
      if (!sdp) throw new Error('The camera offer could not be created.');
      sendSignal(peerId, source, kind, { type: 'offer', sdp });
    } catch (failure) {
      closePeer(peerId, kind);
      setError(`Could not start a camera connection: ${errorMessage(failure)}`);
    }
  }, [closePeer, sendSignal]);

  const onWatcher = useCallback((message: WatcherMessage) => {
    const active = optionsRef.current;
    if (!active || message?.source !== active.source || !message.peerId) return;
    void createPeer({ ...message, kind: message.kind === 'audio' ? 'audio' : 'video' });
  }, [createPeer]);

  const onSignal = useCallback(async (message: SignalMessage) => {
    const active = optionsRef.current;
    if (!active || message?.source !== active.source || !message.from || !message.data) return;
    const record = peersRef.current.get(`${message.from}:${message.kind}`);
    if (!record) return;

    try {
      if (message.data.type === 'answer') {
        await record.peer.setRemoteDescription({ type: 'answer', sdp: message.data.sdp });
        for (const candidate of record.pendingCandidates.splice(0)) {
          await record.peer.addIceCandidate(candidate);
        }
      } else if (message.data.type === 'candidate') {
        if (record.peer.remoteDescription) await record.peer.addIceCandidate(message.data.candidate);
        else record.pendingCandidates.push(message.data.candidate);
      }
    } catch (failure) {
      closePeer(message.from, message.kind);
      setError(`A camera connection was interrupted: ${errorMessage(failure)}`);
    }
  }, [closePeer]);

  const onPeerLeft = useCallback((message: PeerLeftMessage) => {
    const active = optionsRef.current;
    if (active && message?.source === active.source) closePeer(message.peerId, message.kind);
  }, [closePeer]);

  useEffect(() => {
    const onConnect = () => {
      joinedRef.current = null;
      const active = optionsRef.current;
      if (!active || !streamRef.current) return;
      closeAllPeers();
      setStatus('connecting');
      void join().catch(failure => {
        setStatus('error');
        setError(errorMessage(failure));
      });
    };
    const onDisconnect = () => {
      joinedRef.current = null;
      joiningRef.current = null;
      closeAllPeers();
      if (streamRef.current) {
        setStatus('reconnecting');
        setError('Signaling disconnected. Trying to reconnect…');
      }
    };
    const onConnectError = () => {
      if (streamRef.current) {
        setStatus('reconnecting');
        setError('Could not reach the signaling server. Check the network; reconnecting…');
      }
    };

    socket.on('input:watcher', onWatcher);
    socket.on('input:signal', onSignal);
    socket.on('input:peer-left', onPeerLeft);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);

    return () => {
      socket.off('input:watcher', onWatcher);
      socket.off('input:signal', onSignal);
      socket.off('input:peer-left', onPeerLeft);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
    };
  }, [closeAllPeers, join, onPeerLeft, onSignal, onWatcher]);

  const start = useCallback(async (options: BroadcasterOptions) => {
    const operation = ++operationRef.current;
    if (optionsRef.current && optionsRef.current.source !== options.source) {
      if (socket.connected) socket.emit('input:leave', { source: optionsRef.current.source });
      closeAllPeers();
      joinedRef.current = null;
      joiningRef.current = null;
    }
    optionsRef.current = options;
    setError(null);

    let stream = streamRef.current;
    if (!stream || stream.getTracks().every(track => track.readyState === 'ended')) {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus('error');
        setError('Camera and microphone capture is unavailable in this browser. Open this page in a modern browser over HTTPS.');
        return;
      }

      setStatus('requesting');
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      } catch (failure) {
        if (operationRef.current === operation) {
          setStatus('error');
          setError(errorMessage(failure));
        }
        return;
      }

      if (operationRef.current !== operation) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      const capturedStream = stream;
      streamRef.current = capturedStream;
      setLocalStream(capturedStream);
      capturedStream.getTracks().forEach(track => {
        track.addEventListener('ended', () => {
          if (streamRef.current !== capturedStream) return;
          const active = optionsRef.current;
          if (active && socket.connected) socket.emit('input:leave', { source: active.source });
          closeAllPeers();
          joinedRef.current = null;
          streamRef.current = null;
          setLocalStream(null);
          capturedStream.getTracks().forEach(otherTrack => {
            if (otherTrack.readyState !== 'ended') otherTrack.stop();
          });
          setStatus('error');
          setError('The camera or microphone stopped. Press Stop, check the device, then Start again.');
        });
      });
    }

    setStatus('connecting');
    try {
      await waitForSocket();
      if (operationRef.current !== operation || streamRef.current !== stream) return;
      await join();
    } catch (failure) {
      if (operationRef.current === operation) {
        setStatus('error');
        setError(errorMessage(failure));
      }
    }
  }, [closeAllPeers, join, waitForSocket]);

  const stop = useCallback(() => {
    operationRef.current += 1;
    const options = optionsRef.current;
    const stream = streamRef.current;
    streamRef.current = null;
    optionsRef.current = null;
    joinedRef.current = null;
    joiningRef.current = null;
    if (options && socket.connected) socket.emit('input:leave', { source: options.source });
    closeAllPeers();
    stream?.getTracks().forEach(track => track.stop());
    setLocalStream(null);
    setError(null);
    setStatus('idle');
  }, [closeAllPeers]);

  useEffect(() => () => {
    operationRef.current += 1;
    const options = optionsRef.current;
    const stream = streamRef.current;
    streamRef.current = null;
    optionsRef.current = null;
    joinedRef.current = null;
    joiningRef.current = null;
    if (options && socket.connected) socket.emit('input:leave', { source: options.source });
    closeAllPeers();
    stream?.getTracks().forEach(track => track.stop());
  }, [closeAllPeers]);

  return { localStream, stream: localStream, status, error, start, stop };
}
