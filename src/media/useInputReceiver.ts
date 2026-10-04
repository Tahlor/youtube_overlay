import { useEffect, useState } from 'react';
import type { InputSource } from '../shared/types';
import { socket } from '../socket';
import { iceServers } from './ice';

type SignalData = { type: 'offer'; sdp: string } | { type: 'candidate'; candidate: RTCIceCandidateInit };
type IncomingSignal = { from: string; source: InputSource; kind?: 'video' | 'audio'; data: SignalData };

export function useInputReceiver(source: InputSource | null, enabled: boolean, kind: 'video' | 'audio' = 'video') {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState('Idle');
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled || !source || source === 'youtube') { setStream(null); setStatus('Idle'); setError(null); setFailed(false); return; }
    let disposed = false;
    let peer: RTCPeerConnection | null = null;
    let peerId: string | null = null;
    let watching = false;
    let registered = false;
    let candidates: RTCIceCandidateInit[] = [];
    let connectionTimer: ReturnType<typeof setTimeout> | undefined;
    setStream(null); setStatus('Connecting…'); setError(null); setFailed(false);

    function clearConnectionTimer() { clearTimeout(connectionTimer); connectionTimer = undefined; }

    function closePeer() {
      clearConnectionTimer();
      if (peer) { peer.ontrack = null; peer.onicecandidate = null; peer.onconnectionstatechange = null; }
      peer?.close(); peer = null; peerId = null; candidates = [];
      setStream(null);
    }

    function fail(message: string) {
      if (disposed) return;
      closePeer(); registered = false;
      if (socket.connected) socket.emit('input:unwatch', { source, kind });
      setStatus('Connection lost'); setError(message); setFailed(true);
    }

    function waitForMedia() {
      clearConnectionTimer();
      connectionTimer = setTimeout(() => fail('Camera media could not connect. Retry the input; restrictive networks may require TURN.'), 15000);
    }

    function watch() {
      if (!socket.connected || disposed || watching || registered) return;
      watching = true;
      setStatus('Connecting…');
      socket.timeout(5000).emit('input:watch', { source, kind }, (timeout: Error | null, response?: { ok: boolean; error?: string; peerId?: string }) => {
        watching = false;
        if (disposed) return;
        if (timeout || !response?.ok) { fail(response?.error ?? 'Unable to connect to input.'); return; }
        registered = true;
        if (response.peerId) peerId = response.peerId;
        if (peer?.connectionState !== 'connected') { setStatus('Waiting for media…'); waitForMedia(); }
      });
    }

    async function onSignal(message: IncomingSignal) {
      if (disposed || message.source !== source || (message.kind && message.kind !== kind) || !message.data || (peerId && message.from !== peerId)) return;
      if (message.data.type === 'offer') {
        let offeredPeer: RTCPeerConnection | null = null;
        try {
          const earlyCandidates = candidates;
          closePeer(); peerId = message.from;
          const connection = new RTCPeerConnection({ iceServers });
          offeredPeer = connection;
          peer = connection;
          waitForMedia();
          connection.ontrack = event => {
            if (disposed || peer !== connection) return;
            const nextStream = event.streams[0] ?? new MediaStream([event.track]);
            setStream(nextStream);
            event.track.addEventListener('ended', () => { if (peer === connection) fail('Camera media stopped. Retry the input.'); }, { once: true });
          };
          connection.onicecandidate = event => {
            if (!disposed && peer === connection && event.candidate && socket.connected) socket.emit('input:signal', { to: message.from, source, kind, data: { type: 'candidate', candidate: event.candidate.toJSON() } });
          };
          connection.onconnectionstatechange = () => {
            if (disposed || peer !== connection) return;
            if (connection.connectionState === 'failed') fail('Camera connection failed. Retry the input; restrictive networks may require TURN.');
            if (connection.connectionState === 'disconnected') {
              clearConnectionTimer();
              setStatus('Reconnecting media…');
              connectionTimer = setTimeout(() => fail('Camera connection lost. Retry the input; restrictive networks may require TURN.'), 5000);
            }
            if (connection.connectionState === 'connected') { clearConnectionTimer(); setStatus('Live'); setError(null); setFailed(false); }
          };
          await connection.setRemoteDescription({ type: 'offer', sdp: message.data.sdp });
          if (disposed || peer !== connection) return;
          for (const candidate of earlyCandidates) await connection.addIceCandidate(candidate);
          for (const candidate of candidates.splice(0)) await connection.addIceCandidate(candidate);
          const answer = await connection.createAnswer();
          if (disposed || peer !== connection) return;
          await connection.setLocalDescription(answer);
          if (disposed || peer !== connection) return;
          socket.emit('input:signal', { to: message.from, source, kind, data: { type: 'answer', sdp: answer.sdp } });
        } catch (failure) { if (peer === offeredPeer) fail(`Camera connection error: ${(failure as Error).message}. Restrictive networks may require TURN.`); }
      } else if (message.data.type === 'candidate') {
        try {
          if (peer?.remoteDescription) await peer.addIceCandidate(message.data.candidate);
          else candidates.push(message.data.candidate);
        } catch (failure) { if (!disposed) setError((failure as Error).message); }
      }
    }

    function onPeerLeft(message: { source: InputSource; peerId: string; kind?: 'video' | 'audio' }) {
      if (message.source !== source || (message.kind && message.kind !== kind) || (peerId && message.peerId !== peerId)) return;
      fail('Input disconnected. Output will return to YouTube.');
    }
    function onDisconnect() { closePeer(); watching = false; registered = false; setStatus('Signaling disconnected'); setError('Reconnecting to signaling…'); setFailed(true); }
    function onAvailability(value: Record<string, boolean>) { if (value[source!]) watch(); }
    socket.on('input:signal', onSignal);
    socket.on('input:peer-left', onPeerLeft);
    socket.on('disconnect', onDisconnect);
    socket.on('connect', watch);
    socket.on('input:availability', onAvailability);
    if (socket.connected) watch(); else socket.connect();
    return () => {
      disposed = true;
      socket.off('input:signal', onSignal);
      socket.off('input:peer-left', onPeerLeft);
      socket.off('disconnect', onDisconnect);
      socket.off('connect', watch);
      socket.off('input:availability', onAvailability);
      if (socket.connected) socket.emit('input:unwatch', { source, kind });
      clearConnectionTimer();
      peer?.close();
    };
  }, [source, enabled, kind, attempt]);

  return { stream, status, error, failed, retry: () => setAttempt(value => value + 1) };
}
