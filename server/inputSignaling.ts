import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import type { CameraSource, InputSource, ProgramState } from '../src/shared/types.js';
import { CAMERA_SOURCES, effectiveAudioSource, isCameraSource } from '../src/shared/input.js';

type WatchKind = 'video' | 'audio';
type Acknowledge = (result: Record<string, unknown>) => void;
type InputSocket = Socket;

interface BroadcasterRecord { socketId: string }
interface WatcherRecord { kind: WatchKind }
interface SignalingProgram {
  getState(): ProgramState;
}

export interface InputSignalingManager {
  isAvailable(source: CameraSource): boolean;
  getAvailability(): Record<CameraSource, boolean>;
  refreshAccess(): void;
}

interface Options {
  basePath: string;
  onSelectedCameraDisconnected(source: CameraSource): void;
}

const PHONE_SOURCES = ['phone1', 'phone2', 'phone3', 'phone4'] as const;
const inviteTokens = Object.fromEntries(PHONE_SOURCES.map(source => [source, randomBytes(32).toString('base64url')])) as Record<(typeof PHONE_SOURCES)[number], string>;

/**
 * Installs the private phone invite, broadcaster, watcher, and WebRTC relay events.
 * Invite tokens live only in this process and are returned only to a claimed Director.
 */
export function attachInputSignaling(io: Server, program: SignalingProgram, options: Options): InputSignalingManager {
  const broadcasters = new Map<CameraSource, BroadcasterRecord>();
  const watchers = new Map<CameraSource, Map<string, WatcherRecord>>();
  const broadcasterSources = new Map<string, Set<CameraSource>>();
  const watcherSources = new Map<string, Set<CameraSource>>();
  const directors = new Set<string>();

  const manager: InputSignalingManager = {
    isAvailable: source => broadcasters.has(source),
    getAvailability: () => Object.fromEntries(CAMERA_SOURCES.map(source => [source, broadcasters.has(source)])) as Record<CameraSource, boolean>,
    refreshAccess: () => {
      const state = program.getState();
      for (const source of CAMERA_SOURCES) {
        const current = watchers.get(source);
        const broadcasterId = broadcasters.get(source)?.socketId;
        if (!current || !broadcasterId) continue;
        for (const [watcherId, record] of current) {
          if (directors.has(watcherId) || isPublicWatchAllowed(state, source, record.kind)) continue;
          current.delete(watcherId);
          removeWatcherSource(watcherId, source);
          io.to(watcherId).emit('input:peer-left', { source, peerId: broadcasterId, kind: record.kind });
          io.to(broadcasterId).emit('input:peer-left', { source, peerId: watcherId, kind: record.kind });
        }
        if (current.size === 0) watchers.delete(source);
      }
      publishAvailability();
    },
  };

  function publishAvailability() {
    io.emit('input:availability', manager.getAvailability());
  }

  function addBroadcaster(socket: InputSocket, source: CameraSource): void {
    let owned = broadcasterSources.get(socket.id);
    if (!owned) broadcasterSources.set(socket.id, owned = new Set());
    owned.add(source);
    broadcasters.set(source, { socketId: socket.id });
    // A Director preview may have been waiting for a camera to come online.
    for (const [watcherId, record] of watchers.get(source) ?? []) {
      io.to(socket.id).emit('input:watcher', { source, peerId: watcherId, kind: record.kind });
    }
    publishAvailability();
  }

  function removeWatcherSource(socketId: string, source: CameraSource): void {
    const owned = watcherSources.get(socketId);
    owned?.delete(source);
    if (owned?.size === 0) watcherSources.delete(socketId);
  }

  function removeWatcher(socketId: string, source: CameraSource, kind?: WatchKind): void {
    const sourceWatchers = watchers.get(source);
    const record = sourceWatchers?.get(socketId);
    if (!record || (kind && record.kind !== kind)) return;
    sourceWatchers!.delete(socketId);
    removeWatcherSource(socketId, source);
    if (sourceWatchers!.size === 0) watchers.delete(source);
    const broadcasterId = broadcasters.get(source)?.socketId;
    if (broadcasterId) io.to(broadcasterId).emit('input:peer-left', { source, peerId: socketId, kind: record.kind });
  }

  function removeBroadcaster(socketId: string, source: CameraSource): void {
    if (broadcasters.get(source)?.socketId !== socketId) return;
    broadcasters.delete(source);
    const owned = broadcasterSources.get(socketId);
    owned?.delete(source);
    if (owned?.size === 0) broadcasterSources.delete(socketId);

    for (const [watcherId] of watchers.get(source) ?? []) {
      io.to(watcherId).emit('input:peer-left', { source, peerId: socketId });
      removeWatcherSource(watcherId, source);
    }
    watchers.delete(source);
    publishAvailability();

    if (program.getState().source === source) options.onSelectedCameraDisconnected(source);
  }

  function isAuthorized(socketId: string, source: CameraSource, kind: WatchKind): boolean {
    return directors.has(socketId) || isPublicWatchAllowed(program.getState(), source, kind);
  }

  function reject(socket: InputSocket, ack: unknown, error: string, source?: unknown): void {
    const result = { ok: false, error };
    if (typeof ack === 'function') (ack as Acknowledge)(result);
    else socket.emit('input:error', { ...(isCameraSource(source) ? { source } : {}), error });
  }

  io.on('connection', (socket: InputSocket) => {
    socket.emit('input:availability', manager.getAvailability());

    socket.on('input:director', (ack?: unknown) => {
      directors.add(socket.id);
      if (typeof ack === 'function') (ack as Acknowledge)({ ok: true });
      socket.emit('input:availability', manager.getAvailability());
    });

    socket.on('input:invites', (ack?: unknown) => {
      if (!directors.has(socket.id)) {
        reject(socket, ack, 'Claim the Director connection before requesting phone links.');
        return;
      }
      const links = Object.fromEntries(PHONE_SOURCES.map(source => [
        source,
        `${options.basePath}/phone?source=${source}&token=${encodeURIComponent(inviteTokens[source])}`,
      ]));
      if (typeof ack === 'function') (ack as Acknowledge)({ ok: true, links });
    });

    socket.on('input:join', (payload: { source?: unknown; token?: unknown } | null, ack?: unknown) => {
      const source = payload?.source;
      if (!(PHONE_SOURCES as readonly unknown[]).includes(source)) {
        reject(socket, ack, 'Choose a valid phone input.', source);
        return;
      }
      const phoneSource = source as (typeof PHONE_SOURCES)[number];
      if (!matchesToken(payload?.token, inviteTokens[phoneSource])) {
        reject(socket, ack, 'This phone link is invalid or expired. Ask the Director for a fresh link.', phoneSource);
        return;
      }
      if (!claimBroadcaster(socket, phoneSource, ack)) return;
      if (typeof ack === 'function') (ack as Acknowledge)({ ok: true, source: phoneSource });
    });

    socket.on('input:join-director', (payload: { source?: unknown } | null, ack?: unknown) => {
      if (payload?.source !== 'director') {
        reject(socket, ack, 'Choose the Director camera input.', payload?.source);
        return;
      }
      if (!directors.has(socket.id)) {
        reject(socket, ack, 'Claim the Director connection before starting its camera.', 'director');
        return;
      }
      if (!claimBroadcaster(socket, 'director', ack)) return;
      if (typeof ack === 'function') (ack as Acknowledge)({ ok: true, source: 'director' });
    });

    socket.on('input:watch', (payload: { source?: unknown; kind?: unknown } | null, ack?: unknown) => {
      if (!isCameraSource(payload?.source) || !isWatchKind(payload.kind)) {
        reject(socket, ack, 'Choose a valid camera input and media type.', payload?.source);
        return;
      }
      const source = payload.source;
      const kind = payload.kind;
      const broadcasterId = broadcasters.get(source)?.socketId;
      if (!broadcasterId) {
        reject(socket, ack, 'This camera input is offline.', source);
        return;
      }
      if (!isAuthorized(socket.id, source, kind)) {
        reject(socket, ack, 'This camera input is not selected for Output.', source);
        return;
      }

      let sourceWatchers = watchers.get(source);
      if (!sourceWatchers) watchers.set(source, sourceWatchers = new Map());
      const previous = sourceWatchers.get(socket.id);
      if (previous && previous.kind !== kind) removeWatcher(socket.id, source, previous.kind);
      // removeWatcher drops the source map when this was the last old kind.
      if (watchers.get(source) !== sourceWatchers) watchers.set(source, sourceWatchers);
      sourceWatchers.set(socket.id, { kind });
      let owned = watcherSources.get(socket.id);
      if (!owned) watcherSources.set(socket.id, owned = new Set());
      owned.add(source);
      io.to(broadcasterId).emit('input:watcher', { source, peerId: socket.id, kind });
      if (typeof ack === 'function') (ack as Acknowledge)({ ok: true, peerId: broadcasterId });
    });

    socket.on('input:unwatch', (payload: { source?: unknown; kind?: unknown } | null) => {
      if (!isCameraSource(payload?.source)) return;
      removeWatcher(socket.id, payload.source, isWatchKind(payload.kind) ? payload.kind : undefined);
    });

    socket.on('input:leave', (payload: { source?: unknown } | null) => {
      if (!isCameraSource(payload?.source)) return;
      removeBroadcaster(socket.id, payload.source);
    });

    socket.on('input:signal', (payload: { to?: unknown; source?: unknown; kind?: unknown; data?: unknown } | null, ack?: unknown) => {
      const source = payload?.source;
      const kind = payload?.kind;
      const to = payload?.to;
      if (!isCameraSource(source) || !isWatchKind(kind) || typeof to !== 'string' || to.length > 128 || !isSignalData(payload?.data)) {
        reject(socket, ack, 'Invalid WebRTC signal.', source);
        return;
      }
      const broadcasterId = broadcasters.get(source)?.socketId;
      const watcher = watchers.get(source)?.get(socket.id);
      const isBroadcaster = broadcasterId === socket.id;
      const isWatcher = watcher?.kind === kind;
      const peerIsWatcher = watchers.get(source)?.get(to)?.kind === kind;
      const validPair = isBroadcaster ? peerIsWatcher : isWatcher && to === broadcasterId;
      if (!validPair) {
        reject(socket, ack, 'This WebRTC peer is no longer authorized.', source);
        return;
      }
      io.to(to).emit('input:signal', { source, from: socket.id, kind, data: payload!.data });
      if (typeof ack === 'function') (ack as Acknowledge)({ ok: true });
    });

    socket.on('disconnect', () => {
      for (const source of [...(watcherSources.get(socket.id) ?? [])]) removeWatcher(socket.id, source);
      for (const source of [...(broadcasterSources.get(socket.id) ?? [])]) removeBroadcaster(socket.id, source);
      broadcasterSources.delete(socket.id);
      watcherSources.delete(socket.id);
      directors.delete(socket.id);
    });
  });

  function claimBroadcaster(socket: InputSocket, source: CameraSource, ack: unknown): boolean {
    const existing = broadcasters.get(source);
    if (existing && existing.socketId !== socket.id) {
      reject(socket, ack, 'This input is already connected from another device.', source);
      return false;
    }
    addBroadcaster(socket, source);
    return true;
  }

  return manager;
}

function matchesToken(candidate: unknown, expectedToken: string): boolean {
  if (typeof candidate !== 'string' || candidate.length !== expectedToken.length) return false;
  return timingSafeEqual(Buffer.from(candidate), Buffer.from(expectedToken));
}

function isWatchKind(value: unknown): value is WatchKind {
  return value === 'video' || value === 'audio';
}

function isPublicWatchAllowed(state: ProgramState, source: CameraSource, kind: WatchKind): boolean {
  const publicSource: InputSource = kind === 'video'
    ? state.source
    : effectiveAudioSource(state.source, state.audio);
  return publicSource === source;
}

function isSignalData(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  if ((data.type === 'offer' || data.type === 'answer') && typeof data.sdp === 'string') {
    return data.sdp.length > 0 && data.sdp.length <= 28_000;
  }
  if (data.type !== 'candidate' || !data.candidate || typeof data.candidate !== 'object' || Array.isArray(data.candidate)) return false;
  const candidate = data.candidate as Record<string, unknown>;
  if (typeof candidate.candidate !== 'string' || candidate.candidate.length > 4_096) return false;
  if (candidate.sdpMid !== undefined && candidate.sdpMid !== null && (typeof candidate.sdpMid !== 'string' || candidate.sdpMid.length > 100)) return false;
  if (candidate.sdpMLineIndex !== undefined && candidate.sdpMLineIndex !== null &&
    (typeof candidate.sdpMLineIndex !== 'number' || !Number.isSafeInteger(candidate.sdpMLineIndex) || candidate.sdpMLineIndex < 0 || candidate.sdpMLineIndex > 256)) return false;
  if (candidate.usernameFragment !== undefined && candidate.usernameFragment !== null &&
    (typeof candidate.usernameFragment !== 'string' || candidate.usernameFragment.length > 256)) return false;
  return true;
}
