import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { io, type Socket } from 'socket.io-client';
import type { CommandAck, ProgramState } from '../src/shared/types.js';

async function start(dataPath: string) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    env: { ...process.env, PORT: '0', HOST: '127.0.0.1', BASE_PATH: '', DATA_PATH: dataPath },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server startup timeout')), 10_000);
    child.stdout!.on('data', chunk => {
      const match = String(chunk).match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`); }
    });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}`)); });
  });
  return { child, url };
}

async function stop(child: ChildProcess) {
  if (child.exitCode !== null) return;
  await new Promise<void>(resolve => { child.once('exit', () => resolve()); child.kill('SIGTERM'); });
}

async function connect(url: string) {
  const socket = io(url, { path: '/socket.io', transports: ['websocket'], forceNew: true, autoConnect: false });
  const initial = await new Promise<ProgramState>((resolve, reject) => {
    socket.once('program:state', resolve);
    socket.once('connect_error', error => { socket.disconnect(); reject(error); });
    socket.connect();
  });
  return { socket, initial };
}

function command(socket: Socket, event: string, payload?: unknown): Promise<CommandAck> {
  return new Promise((resolve, reject) => {
    const callback = (error: Error | null, result: CommandAck) => error ? reject(error) : resolve(result);
    if (payload === undefined) socket.timeout(3000).emit(event, callback);
    else socket.timeout(3000).emit(event, payload, callback);
  });
}

function state(socket: Socket): Promise<ProgramState> {
  return new Promise(resolve => { socket.once('program:state', resolve); socket.emit('program:get-state'); });
}

test('TAKE and Return reject a stale staged Program revision', { timeout: 20_000 }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'overlay-revision-'));
  let running: Awaited<ReturnType<typeof start>> | undefined;
  let socket: Socket | undefined;
  try {
    running = await start(path.join(dir, 'db.sqlite'));
    const connected = await connect(running.url);
    socket = connected.socket;

    assert.equal((await command(socket, 'program:set-video', { videoId: 'aqz-KE-bpKQ' })).ok, true);
    const stagedRevision = (await state(socket)).revision;

    assert.equal((await command(socket, 'program:set-video', { videoId: 'dQw4w9WgXcQ' })).ok, true);
    const newer = await state(socket);
    assert.ok(newer.revision > stagedRevision);

    const asset = { id: 'still', title: 'Still image', fullUrl: '/test-graphic.svg' };
    const staleTake = await command(socket, 'program:take', {
      asset,
      presentation: { layout: 'image', corner: 'bottom-right', size: 'medium', transition: 'fade', fit: 'contain', motion: 'auto' },
      expectedRevision: stagedRevision,
    });
    assert.equal(staleTake.ok, false);
    assert.match(staleTake.error ?? '', /Program changed/);
    assert.deepEqual(await state(socket), newer);

    const acceptedTake = await command(socket, 'program:take', {
      asset,
      presentation: { layout: 'image', corner: 'bottom-right', size: 'medium', transition: 'fade', fit: 'contain', motion: 'auto' },
      expectedRevision: newer.revision,
    });
    assert.equal(acceptedTake.ok, true);
    const onAir = await state(socket);
    assert.equal(onAir.scene.kind, 'image');

    const staleReturn = await command(socket, 'program:live', { expectedRevision: newer.revision });
    assert.equal(staleReturn.ok, false);
    assert.match(staleReturn.error ?? '', /Program changed/);
    assert.deepEqual(await state(socket), onAir);

    assert.equal((await command(socket, 'program:live', { expectedRevision: onAir.revision })).ok, true);
    assert.deepEqual((await state(socket)).scene, { kind: 'main' });
  } finally {
    socket?.disconnect();
    if (running) await stop(running.child);
    rmSync(dir, { recursive: true, force: true });
  }
});
