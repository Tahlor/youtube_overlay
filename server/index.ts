import http from 'node:http';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import express from 'express';
import { Server } from 'socket.io';
import type { CommandAck, ProgramState, PlaybackCommand, PlaybackSample, OutputPlayback } from '../src/shared/types.js';
import { isVideoTime } from '../src/shared/playback.js';
import { isInputSource } from '../src/shared/input.js';
import { normalizeAsset } from '../src/shared/asset.js';
import { ProgramStore } from './programState.js';
import { LibraryStore } from './library.js';
import { createImageSearchRouter } from './imageSearch.js';
import { attachInputSignaling, directorAccessKey } from './inputSignaling.js';

const port = Number.parseInt(process.env.PORT ?? '3001', 10);
const host = process.env.HOST ?? '0.0.0.0';
const basePath = normalizeBasePath(process.env.BASE_PATH ?? '');
const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, { path: `${basePath}/socket.io`, maxHttpBufferSize: 32000 });
const dataPath = process.env.DATA_PATH ?? path.resolve('data/overlay.sqlite');
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
  directorKey: directorAccessKey(dataPath),
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

app.use(`${basePath}/api/images`, createImageSearchRouter());
app.get(`${basePath}/api/library`, (_req,res) => {
  try {
    if (!library) throw new Error();
    res.json(library.list());
  } catch { persistenceError = true; res.status(503).json({ error: 'Saved assets unavailable. Program controls still work.' }); }
});
app.post(`${basePath}/api/library/favorite`, (req,res) => {
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

const webDist = path.resolve('dist');
app.use(basePath || '/', express.static(webDist, { index: false }));
if (basePath) app.get(basePath, (_req,res) => res.redirect(`${basePath}/`));
app.get([`${basePath}/`, `${basePath}/director`, `${basePath}/output`, `${basePath}/phone`], (_req,res) => {
  res.set('Cache-Control', 'no-store').sendFile(path.join(webDist, 'index.html'));
});
app.use((error: { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(error.status ?? 500).json({ error: 'Invalid request.' });
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
      if (typeof payload?.videoId !== 'string') throw new Error('videoId must be a string.');
      return program.setVideo(payload.videoId);
    });
  });
  socket.on('program:set-source', (payload: { source?: unknown }, ack?: unknown) => {
    runCommand(ack, () => {
      if (!inputSignaling.isDirector(socket.id)) throw new Error('Director access is required to switch inputs.');
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
      if (!inputSignaling.isDirector(socket.id)) throw new Error('Director access is required to change audio.');
      return program.setAudio(payload as Parameters<ProgramStore['setAudio']>[0]);
    });
  });
  socket.on('program:take', (payload: { asset?: unknown; presentation?: unknown }, ack?: unknown) => {
    runCommand(ack, () => program.take(normalizeAsset(payload?.asset), payload?.presentation), true);
  });
  socket.on('program:live', (ack?: unknown) => runCommand(ack, () => program.goLive()));
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
