import http from 'node:http';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import express from 'express';
import { Server } from 'socket.io';
import type { CommandAck, ProgramState, PlaybackCommand, PlaybackSample, OutputPlayback } from '../src/shared/types.js';
import { isVideoTime, playbackPosition } from '../src/shared/playback.js';
import { isInputSource } from '../src/shared/input.js';
import { normalizeAsset } from '../src/shared/asset.js';
import { ProgramStore } from './programState.js';
import { LibraryStore } from './library.js';
import { createImageSearchRouter } from './imageSearch.js';
import { LdsLibraryProvider } from './ldsLibrary.js';
import { attachInputSignaling } from './inputSignaling.js';
import { createUploadRouter } from './uploads.js';

const port = Number.parseInt(process.env.PORT ?? '3001', 10);
const host = process.env.HOST ?? '0.0.0.0';
const basePath = normalizeBasePath(process.env.BASE_PATH ?? '');
const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, { path: `${basePath}/socket.io`, maxHttpBufferSize: 32000 });
const dataPath = process.env.DATA_PATH ?? path.resolve('data/overlay.sqlite');
const uploadPath = process.env.UPLOAD_PATH ?? path.join(path.dirname(dataPath), 'uploads');
let library: LibraryStore | null = null;
let persistenceError = false;
try { library = new LibraryStore(dataPath); }
catch { persistenceError = true; console.error('SQLite unavailable; Program controls remain available.'); }
let program: ProgramStore;
try { program = new ProgramStore(library?.readProgram()); }
catch { program = new ProgramStore(); persistenceError = true; console.error('Saved Program unavailable; starting safely in LIVE.'); }
let build: Record<string, unknown> = { commit: 'development' };
let outputPlayback: (OutputPlayback & { socketId: string }) | null = null;
let lastPlaybackSave = 0;
const inputSignaling = attachInputSignaling(io, program, {
  basePath,
  onSelectedCameraDisconnected: source => {
    if (program.getState().source === source) {
      // ProgramStore retains the last saved YouTube position while a camera is on air.
      runCommand(undefined, () => program.fallbackToYouTube(source));
    }
  },
});
try { build = JSON.parse(readFileSync(path.resolve('dist/build.json'), 'utf8')); } catch { /* dev */ }

app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.use(`${basePath}/api`, (_req,res,next) => { res.set('Cache-Control', 'no-store'); next(); });
app.get(`${basePath}/api/healthz`, (_req, res) => {
  res.json({ ok: true, revision: program.getState().revision, persistence: library && !persistenceError ? 'ok' : 'unavailable', build });
});
app.post(`${basePath}/api/director/claim`, requireSsoIdentity, (req, res) => {
  const socketId = req.body?.socketId;
  if (typeof socketId !== 'string' || !socketId || socketId.length > 128) {
    res.status(400).json({ error: 'A current Director connection is required.' });
    return;
  }
  const identity = res.locals.ssoUser as string;
  if (!inputSignaling.claimDirector(socketId, identity)) {
    res.status(409).json({ error: 'Director connection changed. Reconnect and try again.' });
    return;
  }
  res.json({ ok: true, user: identity });
});

const ldsPath = process.env.LDS_PATH ?? path.resolve('data/lds');
const lds = new LdsLibraryProvider(path.join(ldsPath, 'lds.sqlite'), `${basePath}/lds-media`);
for (const dir of ['images', 'thumbs']) {
  app.use(`${basePath}/lds-media/${dir}`, express.static(path.join(ldsPath, dir), { index: false, dotfiles: 'deny', maxAge: '30d', immutable: true }));
}
app.use(`${basePath}/api/images`, requireSsoIdentity, createImageSearchRouter(lds.available ? { lds } : {}));
app.get(`${basePath}/api/library`, requireSsoIdentity, (_req,res) => {
  try {
    if (!library) throw new Error();
    res.json(library.list());
  } catch { persistenceError = true; res.status(503).json({ error: 'Saved assets unavailable. Program controls still work.' }); }
});
app.post(`${basePath}/api/library/favorite`, requireSsoIdentity, (req,res) => {
  let asset;
  try {
    asset = normalizeAsset(req.body?.asset);
    if (typeof req.body?.favorite !== 'boolean') throw new Error('favorite must be a boolean.');
  } catch (error) { res.status(400).json({ error: (error as Error).message }); return; }
  try {
    if (!library) throw new Error();
    library.favorite(asset, req.body.favorite);
    io.emit('library:changed');
    res.json({ ok: true });
  } catch { persistenceError = true; res.status(503).json({ error: 'Could not save favorite. Program controls still work.' }); }
});
app.use(`${basePath}/uploads`, createUploadRouter({
  uploadDir: uploadPath,
  publicBasePath: basePath,
  library,
  isDirectorRequest: req => ssoIdentity(req) !== null,
  onChanged: () => io.emit('library:changed'),
}));

const webDist = path.resolve('dist');
app.use(basePath || '/', express.static(webDist, { index: false }));
app.get(`${basePath}/director`, requireSsoIdentity, (_req,res) => {
  res.set('Cache-Control', 'no-store').sendFile(path.join(webDist, 'index.html'));
});
app.get([`${basePath}/`, `${basePath}/output`, `${basePath}/phone`], (_req,res) => {
  res.set('Cache-Control', 'no-store').sendFile(path.join(webDist, 'index.html'));
});
app.use((error: { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(error.status ?? 500).json({ error: error.status === 413 ? 'Image is too large. Maximum size is 12 MB.' : 'Invalid request.' });
});

io.on('connection', socket => {
  socket.emit('program:state', program.getState(), Date.now());
  socket.on('program:get-state', () => {
    socket.emit('program:state', program.getState(), Date.now());
    socket.emit('playback:output', freshOutput());
  });
  socket.on('program:clock', (ack: unknown) => { if (typeof ack === 'function') ack(Date.now()); });
  let lastReport = 0;
  socket.on('playback:report', (sample: PlaybackSample) => {
    const state = program.getState();
    const now = Date.now();
    if (state.source !== 'youtube' || now - lastReport < 500 || !sample || sample.videoId !== state.videoId || sample.playbackRevision !== state.playback.revision ||
      !isVideoTime(sample.currentTime) || !isVideoTime(sample.duration) || ![-1, 0, 1, 2, 3, 5].includes(sample.playerState) ||
      typeof sample.status !== 'string' || sample.status.length > 300) return;
    lastReport = now;
    outputPlayback = { ...sample, receivedAt: now, socketId: socket.id };
    // Anchor a new stream only once the TV has actually begun playing.
    if (state.playback.position === null && sample.playerState === 1 && sample.duration > 0) {
      runCommand(undefined, () => program.controlPlayback({ videoId: sample.videoId, playbackRevision: sample.playbackRevision, action: 'seek', position: sample.currentTime }));
    } else {
      // Keep reconnects and restarts close to the TV's actual point, including buffering.
      if (state.playback.position !== null && sample.duration > 0 && [0, 1, 2, 3].includes(sample.playerState) &&
        (state.playback.status === 'paused' ? sample.playerState === 2 : sample.playerState !== 2)) {
        const next = program.recordPosition(sample.currentTime);
        if (now - lastPlaybackSave >= 5000) {
          lastPlaybackSave = now;
          try { library?.saveProgram(next); } catch { persistenceError = true; }
        }
      }
      io.emit('playback:output', freshOutput());
    }
  });
  socket.on('program:playback', (payload: PlaybackCommand, ack?: unknown) => {
    runCommand(ack, () => {
      requireDirector(socket.id);
      const observed = freshOutput();
      const position = observed && observed.duration > 0 && [0, 1, 2, 3].includes(observed.playerState) ? observed.currentTime + (observed.playerState === 1 ? (Date.now() - observed.receivedAt) / 1000 : 0) : undefined;
      return program.controlPlayback(payload, position, observed?.duration);
    });
  });
  socket.on('disconnect', () => {
    if (outputPlayback?.socketId === socket.id) { outputPlayback = null; io.emit('playback:output', null); }
  });
  socket.on('program:set-video', (payload: { videoId?: unknown }, ack?: unknown) => {
    runCommand(ack, () => {
      requireDirector(socket.id);
      if (typeof payload?.videoId !== 'string') throw new Error('videoId must be a string.');
      return program.setVideo(payload.videoId);
    });
  });
  socket.on('program:set-source', (payload: { source?: unknown }, ack?: unknown) => {
    runCommand(ack, () => {
      requireDirector(socket.id);
      if (!isInputSource(payload?.source)) throw new Error('Choose a valid input source.');
      if (payload.source !== 'youtube' && !inputSignaling.isAvailable(payload.source)) throw new Error('This camera input is offline.');
      const state = program.getState();
      const output = state.source === 'youtube' ? freshOutput() : null;
      const position = output && output.duration > 0 && [0, 1, 2, 3].includes(output.playerState)
        ? output.currentTime + (output.playerState === 1 ? (Date.now() - output.receivedAt) / 1000 : 0)
        : undefined;
      return program.setSource(payload.source, position);
    });
  });
  socket.on('program:set-audio', (payload: unknown, ack?: unknown) => {
    runCommand(ack, () => {
      requireDirector(socket.id);
      return program.setAudio(payload as Parameters<ProgramStore['setAudio']>[0]);
    });
  });
  socket.on('program:take', (payload: { asset?: unknown; presentation?: unknown; expectedRevision?: unknown }, ack?: unknown) => {
    runCommand(ack, () => {
      requireDirector(socket.id);
      return program.take(normalizeAsset(payload?.asset), payload?.presentation, payload?.expectedRevision);
    }, true);
  });
  socket.on('program:live', (payloadOrAck?: { expectedRevision?: unknown } | unknown, maybeAck?: unknown) => {
    const payload = typeof payloadOrAck === 'function' ? undefined : payloadOrAck as { expectedRevision?: unknown } | undefined;
    const ack = typeof payloadOrAck === 'function' ? payloadOrAck : maybeAck;
    runCommand(ack, () => {
      requireDirector(socket.id);
      return program.goLive(payload?.expectedRevision);
    });
  });
  socket.on('program:force-sync', (ack?: unknown) => {
    runCommand(ack, () => {
      requireDirector(socket.id);
      const state = program.getState();
      if (!state.videoId) throw new Error('No video selected to synchronize.');
      const observed = freshOutput();
      const now = Date.now();
      const position = observed && observed.duration > 0
        ? Math.min(observed.duration, observed.currentTime + (observed.playerState === 1 ? (now - observed.receivedAt) / 1000 : 0))
        : (playbackPosition(state.playback, now) ?? undefined);
      return program.controlPlayback({
        videoId: state.videoId,
        playbackRevision: state.playback.revision,
        action: 'seek',
        position: position !== undefined && isVideoTime(position) ? Math.round(position * 10) / 10 : 0,
      }, position, observed?.duration);
    });
  });
});

function runCommand(ack: unknown, command: () => ProgramState, taken = false) {
  let result: CommandAck;
  try {
    const previous = program.getState();
    const next = command();
    // Broadcast valid core state independently of optional persistence.
    io.emit('program:state', next, Date.now());
    if (next.source !== previous.source || audioSettingsDiffer(next, previous)) inputSignaling.refreshAccess();
    try {
      if (library) {
        library.saveProgram(next);
        if (taken && next.activeAsset) { library.used(next.activeAsset); io.emit('library:changed'); }
      }
    } catch { persistenceError = true; console.error('SQLite write failed; Program command accepted.'); }
    result = { ok: true };
  } catch (error) { result = { ok: false, error: error instanceof Error ? error.message : 'Command failed.' }; }
  // Malformed acknowledgement payloads must never crash the server.
  if (typeof ack === 'function') ack(result);
}
function requireDirector(socketId: string): void {
  if (!inputSignaling.isDirector(socketId)) throw new Error('Director sign-in is required.');
}
function ssoIdentity(req: express.Request): string | null {
  const supplied = req.get('x-auth-request-user')?.trim();
  if (supplied && supplied.length <= 320 && !/[\x00-\x1f\x7f]/.test(supplied)) return supplied;
  if (process.env.NODE_ENV !== 'production') {
    const development = process.env.DEV_SSO_USER?.trim();
    return development && development.length <= 320 ? development : 'local-director';
  }
  return null;
}
function requireSsoIdentity(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const identity = ssoIdentity(req);
  if (!identity) {
    res.status(401).json({ error: 'Webapps sign-in is required for Director access.' });
    return;
  }
  res.locals.ssoUser = identity;
  next();
}
function audioSettingsDiffer(next: ProgramState, previous: ProgramState): boolean {
  if (next.audio.followSelected !== previous.audio.followSelected || next.audio.source !== previous.audio.source) return true;
  return Object.keys(next.audio.levels).some(source => {
    const key = source as keyof ProgramState['audio']['levels'];
    return next.audio.levels[key].muted !== previous.audio.levels[key].muted || next.audio.levels[key].volume !== previous.audio.levels[key].volume;
  });
}
function freshOutput(): OutputPlayback | null {
  const state = program.getState();
  if (!outputPlayback || outputPlayback.videoId !== state.videoId || outputPlayback.playbackRevision !== state.playback.revision || Date.now() - outputPlayback.receivedAt > 5000) return null;
  const { socketId: _socketId, ...sample } = outputPlayback;
  return sample;
}
function normalizeBasePath(value: string) {
  const trimmed = value.trim();
  return !trimmed || trimmed === '/' ? '' : `/${trimmed.replace(/^\/+|\/+$/g, '')}`;
}
httpServer.listen(port, host, () => {
  const bound = httpServer.address();
  console.log(`YouTube Overlay listening on http://${host}:${typeof bound === 'object' && bound ? bound.port : port}${basePath || '/'}`);
});
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => {
  io.close(); httpServer.close(); library?.close(); process.exit(0);
});
