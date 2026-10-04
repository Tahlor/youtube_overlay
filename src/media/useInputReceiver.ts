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

  useEffect(() => {
    if (!enabled || !source || source === 'youtube') { setStream(null); setStatus('Idle'); setError(null); return; }
    let disposed = false;
    let peer: RTCPeerConnection | null = null;
    let peerId: string | null = null;
    let watching = false;
    let registered = false;
    let candidates: RTCIceCandidateInit[] = [];
    setStream(null); setStatus('Connecting…'); setError(null);

    function closePeer() {
      peer?.close(); peer = null; peerId = null; candidates = [];
      setStream(null);
    }

    function watch() {
      if (!socket.connected || disposed || watching || registered) return;
      watching = true;
      setStatus('Connecting…');
      socket.timeout(5000).emit('input:watch', { source, kind }, (timeout: Error | null, response?: { ok: boolean; error?: string; peerId?: string }) => {
        watching = false;
        if (disposed) return;
        if (timeout || !response?.ok) { setStatus('Unavailable'); setError(response?.error ?? 'Unable to connect to input.'); return; }
        registered = true;
        if (response.peerId) peerId = response.peerId;
        setError(null);
        setStatus('Waiting for media…');
      });
    }

    async function onSignal(message: IncomingSignal) {
      if (disposed || message.source !== source || (message.kind && message.kind !== kind) || !message.data || (peerId && message.from !== peerId)) return;
      if (message.data.type === 'offer') {
        try {
          const earlyCandidates = candidates;
          closePeer(); peerId = message.from;
          const connection = new RTCPeerConnection({ iceServers });
          peer = connection;
          connection.ontrack = event => {
            if (disposed) return;
            const nextStream = event.streams[0] ?? new MediaStream([event.track]);
            setStream(nextStream);
            setStatus('Live'); setError(null);
          };
          connection.onicecandidate = event => {
            if (event.candidate && socket.connected) socket.emit('input:signal', { to: message.from, source, kind, data: { type: 'candidate', candidate: event.candidate.toJSON() } });
          };
          connection.onconnectionstatechange = () => {
            if (disposed) return;
            if (connection.connectionState === 'failed' || connection.connectionState === 'disconnected') {
              setStatus('Connection lost'); setError('Camera connection lost. Check the network or retry the input.');
            }
            if (connection.connectionState === 'connected') { setStatus('Live'); setError(null); }
          };
          await connection.setRemoteDescription({ type: 'offer', sdp: message.data.sdp });
          for (const candidate of earlyCandidates) await connection.addIceCandidate(candidate);
          for (const candidate of candidates.splice(0)) await connection.addIceCandidate(candidate);
          const answer = await connection.createAnswer();
          await connection.setLocalDescription(answer);
          socket.emit('input:signal', { to: message.from, source, kind, data: { type: 'answer', sdp: answer.sdp } });
        } catch (failure) { setStatus('Connection error'); setError((failure as Error).message); closePeer(); }
      } else if (message.data.type === 'candidate') {
        try {
          if (peer?.remoteDescription) await peer.addIceCandidate(message.data.candidate);
          else candidates.push(message.data.candidate);
        } catch (failure) { setError((failure as Error).message); }
      }
    }

    function onPeerLeft(message: { source: InputSource; peerId: string }) {
      if (message.source !== source || (peerId && message.peerId !== peerId)) return;
      closePeer(); registered = false; setStatus('Input disconnected'); setError('Input disconnected. Output will return to YouTube.');
    }
    function onDisconnect() { closePeer(); watching = false; registered = false; setStatus('Signaling disconnected'); setError('Reconnecting to signaling…'); }
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
      peer?.close();
    };
  }, [source, enabled, kind]);

  return { stream, status, error };
}
