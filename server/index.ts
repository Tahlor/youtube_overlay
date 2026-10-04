import http from 'node:http';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import express from 'express';
import { Server } from 'socket.io';
import type { CommandAck, ProgramState } from '../src/shared/types.js';
import { normalizeAsset } from '../src/shared/asset.js';
import { ProgramStore } from './programState.js';
import { LibraryStore } from './library.js';
import { WikimediaProvider } from './imageProvider.js';

const port = Number.parseInt(process.env.PORT ?? '3001', 10);
const host = process.env.HOST ?? '0.0.0.0';
const basePath = normalizeBasePath(process.env.BASE_PATH ?? '');
const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, { path: `${basePath}/socket.io`, maxHttpBufferSize: 32000 });
const provider = new WikimediaProvider();
let library: LibraryStore | null = null;
let persistenceError = false;
try { library = new LibraryStore(process.env.DATA_PATH ?? path.resolve('data/overlay.sqlite')); }
catch { persistenceError = true; console.error('SQLite unavailable; Program controls remain available.'); }
let program: ProgramStore;
try { program = new ProgramStore(library?.readProgram()); }
catch { program = new ProgramStore(); persistenceError = true; console.error('Saved Program unavailable; starting safely in LIVE.'); }
let build: Record<string, unknown> = { commit: 'development' };
try { build = JSON.parse(readFileSync(path.resolve('dist/build.json'), 'utf8')); } catch { /* dev */ }

app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.use(`${basePath}/api`, (_req,res,next) => { res.set('Cache-Control', 'no-store'); next(); });
app.get(`${basePath}/api/healthz`, (_req, res) => {
  res.json({ ok: true, revision: program.getState().revision, persistence: library && !persistenceError ? 'ok' : 'unavailable', build });
});

// Bound cache and concurrency so provider outages cannot hold up core controls.
const searchCache = new Map<string, { until: number; assets: Awaited<ReturnType<WikimediaProvider['search']>> }>();
let searches = 0;
app.get(`${basePath}/api/images/search`, async (req,res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (query.length < 2 || query.length > 120) { res.status(400).json({ error: 'Enter 2–120 characters to search.' }); return; }
  const key = query.toLowerCase();
  const cached = searchCache.get(key);
  if (cached && cached.until > Date.now()) { res.json({ assets: cached.assets }); return; }
  if (searches >= 4) { res.status(429).json({ error: 'Image search is busy. Try again shortly.' }); return; }
  searches++;
  try {
    const assets = await provider.search(query);
    if (searchCache.size >= 50) searchCache.delete(searchCache.keys().next().value!);
    searchCache.set(key, { until: Date.now() + 300000, assets });
    res.json({ assets });
  } catch {
    res.status(502).json({ error: 'Image search is unavailable. Try again; Preview, TAKE and LIVE still work.' });
  } finally { searches--; }
});
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
app.get([`${basePath}/`, `${basePath}/director`, `${basePath}/output`], (_req,res) => {
  res.set('Cache-Control', 'no-store').sendFile(path.join(webDist, 'index.html'));
});
app.use((error: { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(error.status ?? 500).json({ error: 'Invalid request.' });
});

io.on('connection', socket => {
  socket.emit('program:state', program.getState());
  socket.on('program:get-state', () => socket.emit('program:state', program.getState()));
  socket.on('program:set-video', (payload: { videoId?: unknown }, ack?: unknown) => {
    runCommand(ack, () => {
      if (typeof payload?.videoId !== 'string') throw new Error('videoId must be a string.');
      return program.setVideo(payload.videoId);
    });
  });
  socket.on('program:take', (payload: { asset?: unknown }, ack?: unknown) => {
    runCommand(ack, () => program.take(normalizeAsset(payload?.asset)), true);
  });
  socket.on('program:live', (ack?: unknown) => runCommand(ack, () => program.goLive()));
});

function runCommand(ack: unknown, command: () => ProgramState, taken = false) {
  let result: CommandAck;
  try {
    const next = command();
    // Broadcast valid core state independently of optional persistence.
    io.emit('program:state', next);
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
