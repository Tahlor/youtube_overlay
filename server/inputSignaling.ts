import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import type { CameraSource, InputSource, ProgramState } from '../src/shared/types.js';
import { CAMERA_SOURCES, effectiveAudioSource, isCameraSource } from '../src/shared/input.js';

type WatchKind = 'video' | 'audio';
type Acknowledge = (result: Record<string, unknown>) => void;
type InputSocket = Socket;

interface BroadcasterRecord { socketId: string }
interface DirectorClaim { identity: string; expiresAt: number }
interface WatcherRecord { socketId: string; kind: WatchKind }
interface SignalingProgram {
  getState(): ProgramState;
}

export interface InputSignalingManager {
  claimDirector(socketId: string, identity: string): boolean;
  isAvailable(source: CameraSource): boolean;
  isDirector(socketId: string): boolean;
  getAvailability(): Record<CameraSource, boolean>;
  refreshAccess(): void;
}

interface Options {
  basePath: string;
  directorClaimTtlMs?: number;
  onSelectedCameraDisconnected(source: CameraSource): void;
}

const PHONE_SOURCES = ['phone1', 'phone2', 'phone3', 'phone4'] as const;
const inviteTokens = Object.fromEntries(PHONE_SOURCES.map(source => [source, randomBytes(32).toString('base64url')])) as Record<(typeof PHONE_SOURCES)[number], string>;

/**
 * Installs the private phone invite, broadcaster, watcher, and WebRTC relay events.
 * Director sockets are claimed only by the SSO-authenticated HTTP boundary in
 * server/index.ts. Public sockets cannot self-promote by emitting an event.
 */
export function attachInputSignaling(io: Server, program: SignalingProgram, options: Options): InputSignalingManager {
  const broadcasters = new Map<CameraSource, BroadcasterRecord>();
  const watchers = new Map<CameraSource, Map<string, WatcherRecord>>();
  const broadcasterSources = new Map<string, Set<CameraSource>>();
  const watcherSources = new Map<string, Map<CameraSource, Set<WatchKind>>>();
  const directorClaimTtlMs = Number.isSafeInteger(options.directorClaimTtlMs) && (options.directorClaimTtlMs ?? 0) >= 100
    ? options.directorClaimTtlMs!
    : 90_000;
  const directors = new Map<string, DirectorClaim>();

  const manager: InputSignalingManager = {
    claimDirector: (socketId, identity) => {
      const normalizedIdentity = identity.trim();
      if (!normalizedIdentity || normalizedIdentity.length > 320 || /[\x00-\x1f\x7f]/.test(normalizedIdentity) || !io.sockets.sockets.has(socketId)) return false;
      directors.set(socketId, { identity: normalizedIdentity, expiresAt: Date.now() + directorClaimTtlMs });
      io.to(socketId).emit('input:availability', manager.getAvailability());
      return true;
    },
    isAvailable: source => broadcasters.has(source),
    isDirector: socketId => {
      const claim = directors.get(socketId);
      if (!claim) return false;
      if (claim.expiresAt <= Date.now()) {
        directors.delete(socketId);
        return false;
      }
      return true;
    },
    getAvailability: () => Object.fromEntries(CAMERA_SOURCES.map(source => [source, broadcasters.has(source)])) as Record<CameraSource, boolean>,
    refreshAccess: () => {
      const state = program.getState();
      for (const source of CAMERA_SOURCES) {
        const current = watchers.get(source);
        const broadcasterId = broadcasters.get(source)?.socketId;
        if (!current || !broadcasterId) continue;
        for (const [peerKey, record] of current) {
          if (manager.isDirector(record.socketId) || isPublicWatchAllowed(state, source, record.kind)) continue;
          current.delete(peerKey);
          removeWatcherSource(record.socketId, source, record.kind);
          io.to(record.socketId).emit('input:peer-left', { source, peerId: broadcasterId, kind: record.kind });
          io.to(broadcasterId).emit('input:peer-left', { source, peerId: record.socketId, kind: record.kind });
        }
        if (current.size === 0) watchers.delete(source);
      }
      publishAvailability();
    },
  };

  const expirySweep = setInterval(() => {
    let expired = false;
    const now = Date.now();
    for (const [socketId, claim] of directors) {
      if (claim.expiresAt > now) continue;
      directors.delete(socketId);
      expired = true;
    }
    if (expired) manager.refreshAccess();
  }, Math.max(100, Math.min(15_000, Math.floor(directorClaimTtlMs / 3))));
  expirySweep.unref();

  function publishAvailability() {
    io.emit('input:availability', manager.getAvailability());
  }

  function addBroadcaster(socket: InputSocket, source: CameraSource): void {
    let owned = broadcasterSources.get(socket.id);
    if (!owned) broadcasterSources.set(socket.id, owned = new Set());
    owned.add(source);
    broadcasters.set(source, { socketId: socket.id });
    // A Director preview may have been waiting for a camera to come online.
    for (const record of watchers.get(source)?.values() ?? []) {
      io.to(socket.id).emit('input:watcher', { source, peerId: record.socketId, kind: record.kind });
    }
    publishAvailability();
  }

  function removeWatcherSource(socketId: string, source: CameraSource, kind: WatchKind): void {
    const bySource = watcherSources.get(socketId);
    const kinds = bySource?.get(source);
    kinds?.delete(kind);
    if (kinds?.size === 0) bySource?.delete(source);
    if (bySource?.size === 0) watcherSources.delete(socketId);
  }

  function removeWatcher(socketId: string, source: CameraSource, kind?: WatchKind): void {
    const sourceWatchers = watchers.get(source);
    if (!sourceWatchers) return;
    const records = [...sourceWatchers.values()].filter(record => record.socketId === socketId && (!kind || record.kind === kind));
    for (const record of records) {
      sourceWatchers.delete(watcherKey(record.socketId, record.kind));
      removeWatcherSource(socketId, source, record.kind);
      const broadcasterId = broadcasters.get(source)?.socketId;
      if (broadcasterId) io.to(broadcasterId).emit('input:peer-left', { source, peerId: socketId, kind: record.kind });
    }
    if (sourceWatchers.size === 0) watchers.delete(source);
  }

  function removeBroadcaster(socketId: string, source: CameraSource): void {
    if (broadcasters.get(source)?.socketId !== socketId) return;
    broadcasters.delete(source);
    const owned = broadcasterSources.get(socketId);
    owned?.delete(source);
    if (owned?.size === 0) broadcasterSources.delete(socketId);

    for (const record of watchers.get(source)?.values() ?? []) {
      io.to(record.socketId).emit('input:peer-left', { source, peerId: socketId, kind: record.kind });
      removeWatcherSource(record.socketId, source, record.kind);
    }
    watchers.delete(source);
    publishAvailability();

    if (program.getState().source === source) options.onSelectedCameraDisconnected(source);
  }

  function isAuthorized(socketId: string, source: CameraSource, kind: WatchKind): boolean {
    return manager.isDirector(socketId) || isPublicWatchAllowed(program.getState(), source, kind);
  }

  function reject(socket: InputSocket, ack: unknown, error: string, source?: unknown): void {
    const result = { ok: false, error };
    if (typeof ack === 'function') (ack as Acknowledge)(result);
    else socket.emit('input:error', { ...(isCameraSource(source) ? { source } : {}), error });
  }

  io.on('connection', (socket: InputSocket) => {
    socket.emit('input:availability', manager.getAvailability());

    socket.on('input:invites', (ack?: unknown) => {
      if (!manager.isDirector(socket.id)) {
        reject(socket, ack, 'Sign in to Director before requesting phone links.');
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
      if (!manager.isDirector(socket.id)) {
        reject(socket, ack, 'Sign in to Director before starting its camera.', 'director');
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
      const peerKey = watcherKey(socket.id, kind);
      sourceWatchers.set(peerKey, { socketId: socket.id, kind });
      let bySource = watcherSources.get(socket.id);
      if (!bySource) watcherSources.set(socket.id, bySource = new Map());
      let kinds = bySource.get(source);
      if (!kinds) bySource.set(source, kinds = new Set());
      kinds.add(kind);
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
      const watcher = watchers.get(source)?.get(watcherKey(socket.id, kind));
      const isBroadcaster = broadcasterId === socket.id;
      const isWatcher = watcher?.socketId === socket.id && watcher.kind === kind;
      const peerIsWatcher = watchers.get(source)?.get(watcherKey(to, kind))?.kind === kind;
      const validPair = isBroadcaster ? peerIsWatcher : isWatcher && to === broadcasterId;
      if (!validPair) {
        reject(socket, ack, 'This WebRTC peer is no longer authorized.', source);
        return;
      }
      io.to(to).emit('input:signal', { source, from: socket.id, kind, data: payload!.data });
      if (typeof ack === 'function') (ack as Acknowledge)({ ok: true });
    });

    socket.on('disconnect', () => {
      for (const [source, kinds] of [...(watcherSources.get(socket.id) ?? new Map())]) {
        for (const kind of [...kinds]) removeWatcher(socket.id, source, kind);
      }
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
  if (typeof candidate !== 'string') return false;
  const supplied = Buffer.from(candidate);
  const expected = Buffer.from(expectedToken);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function isWatchKind(value: unknown): value is WatchKind {
  return value === 'video' || value === 'audio';
}

function watcherKey(socketId: string, kind: WatchKind): string {
  return `${socketId}:${kind}`;
}

function isPublicWatchAllowed(state: ProgramState, source: CameraSource, kind: WatchKind): boolean {
  if (kind === 'video') return state.source === source;
  const publicAudioSource: InputSource = effectiveAudioSource(state.source, state.audio);
  const level = state.audio.levels[source];
  return publicAudioSource === source && !level.muted && level.volume > 0;
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
