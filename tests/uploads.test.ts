import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { Asset, Library } from '../src/shared/types.js';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=',
  'base64',
);

async function start(dataPath: string, uploadPath: string) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: '0',
      HOST: '127.0.0.1',
      BASE_PATH: '/youtube_overlay',
      DATA_PATH: dataPath,
      UPLOAD_PATH: uploadPath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const origin = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server startup timeout')), 10_000);
    child.stdout!.on('data', chunk => {
      const match = String(chunk).match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`); }
    });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}`)); });
  });
  return { child, origin };
}

async function stop(child: ChildProcess) {
  if (child.exitCode !== null) return;
  await new Promise<void>(resolve => { child.once('exit', () => resolve()); child.kill('SIGTERM'); });
}

async function upload(origin: string, body: Buffer, headers: Record<string, string> = {}) {
  return fetch(`${origin}/youtube_overlay/uploads`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/png', 'X-Upload-Name': encodeURIComponent('Pasted image.png'), ...headers },
    body,
  });
}

test('image upload requires SSO Director identity, validates bytes, persists, deduplicates, and survives restart', { timeout: 25_000 }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'overlay-upload-'));
  const dataPath = path.join(dir, 'state.sqlite');
  const uploadPath = path.join(dir, 'uploads');
  let running: Awaited<ReturnType<typeof start>> | undefined;
  try {
    running = await start(dataPath, uploadPath);

    const denied = await upload(running.origin, ONE_PIXEL_PNG, { 'X-Director-Access-Key': 'legacy-key-is-not-valid' });
    assert.equal(denied.status, 401);

    const disguised = await upload(running.origin, Buffer.from('not a png'), { 'X-Auth-Request-User': 'director@example.test' });
    assert.equal(disguised.status, 415);

    const accepted = await upload(running.origin, ONE_PIXEL_PNG, { 'X-Auth-Request-User': 'director@example.test' });
    assert.equal(accepted.status, 201);
    const first = await accepted.json() as { asset: Asset };
    assert.equal(first.asset.title, 'Pasted image.png');
    assert.equal(first.asset.source, 'Upload');
    assert.match(first.asset.fullUrl, /^\/youtube_overlay\/uploads\/files\/[a-f0-9]{64}\.png$/);

    const bytes = Buffer.from(await (await fetch(running.origin + first.asset.fullUrl)).arrayBuffer());
    assert.deepEqual(bytes, ONE_PIXEL_PNG);

    const duplicate = await upload(running.origin, ONE_PIXEL_PNG, { 'X-Auth-Request-User': 'director@example.test' });
    assert.equal(duplicate.status, 200);
    const second = await duplicate.json() as { asset: Asset };
    assert.equal(second.asset.id, first.asset.id);

    const beforeRestart = await (await fetch(`${running.origin}/youtube_overlay/api/library`, { headers: { 'X-Auth-Request-User': 'director@example.test' } })).json() as Library;
    assert.equal(beforeRestart.uploads.length, 1);
    assert.equal(beforeRestart.uploads[0].asset.id, first.asset.id);

    await stop(running.child);
    running = await start(dataPath, uploadPath);
    const afterRestart = await (await fetch(`${running.origin}/youtube_overlay/api/library`, { headers: { 'X-Auth-Request-User': 'director@example.test' } })).json() as Library;
    assert.equal(afterRestart.uploads.length, 1);
    assert.equal(afterRestart.uploads[0].asset.id, first.asset.id);
    assert.equal((await fetch(running.origin + first.asset.fullUrl)).status, 200);
  } finally {
    if (running) await stop(running.child);
    rmSync(dir, { recursive: true, force: true });
  }
});
