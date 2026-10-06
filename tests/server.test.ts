import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { io, type Socket } from 'socket.io-client';
import type { CommandAck, ProgramState, PlaybackCommand, OutputPlayback } from '../src/shared/types.js';
const prefix='/youtube_overlay';
async function start(data: string, extraEnv: Record<string, string> = {}) {
  const child=spawn(process.execPath,['--import','tsx','server/index.ts'],{env:{...process.env,NODE_ENV:'test',PORT:'0',HOST:'127.0.0.1',BASE_PATH:prefix,DATA_PATH:data,...extraEnv},stdio:['ignore','pipe','pipe']});
  const url=await new Promise<string>((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Server startup timeout')),10000);
    child.stdout!.on('data',chunk=>{ const match=String(chunk).match(/http:\/\/127.0.0.1:(\d+)/); if(match){clearTimeout(timer);resolve(`http://127.0.0.1:${match[1]}`);} });
    child.once('exit',code=>{clearTimeout(timer);reject(new Error(`Server exited ${code}`));});
  });
  return {child,url};
}
async function stop(child: ChildProcess) { await new Promise<void>(resolve=>{ child.once('exit',()=>resolve());child.kill('SIGTERM'); }); }
async function connect(url: string, options: { claimAs?: string; extraHeaders?: Record<string, string> } = {}) {
  const socket=io(url,{path:`${prefix}/socket.io`,transports:['websocket'],forceNew:true,autoConnect:false,extraHeaders:options.extraHeaders});
  const state=await new Promise<ProgramState>((resolve,reject)=>{socket.once('program:state',resolve);socket.once('connect_error',error=>{socket.disconnect();reject(error);});socket.connect();});
  if (options.claimAs) assert.equal((await claimDirector(url, socket, options.claimAs)).ok, true);
  return {socket,state};
}
async function claimDirector(url: string, socket: Socket, identity?: string) {
  const response = await fetch(`${url}${prefix}/api/director/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(identity ? { 'X-Auth-Request-User': identity } : {}) },
    body: JSON.stringify({ socketId: socket.id }),
  });
  return { status: response.status, ...await response.json() } as { status: number; ok?: boolean; user?: string; error?: string };
}
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function command(socket:Socket,event:string,payload?:unknown):Promise<CommandAck>{
  return new Promise((resolve,reject)=>{const cb=(err:Error|null,result:CommandAck)=>err?reject(err):resolve(result);if(payload===undefined)socket.timeout(3000).emit(event,cb);else socket.timeout(3000).emit(event,payload,cb);});
}
function state(socket:Socket):Promise<ProgramState>{return new Promise(resolve=>{socket.once('program:state',resolve);socket.emit('program:get-state');});}
test('real prefixed server: shared state, malformed commands, rapid switching, persistence, restart and reconnect', {timeout:30000},async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'overlay-server-')); let running:Awaited<ReturnType<typeof start>>|undefined; const clients:Socket[]=[];
  try {
    running=await start(path.join(dir,'db.sqlite'));
    const bareRoot = await fetch(`${running.url}${prefix}`, { redirect: 'manual' });
    assert.equal(bareRoot.status, 301);
    assert.equal(bareRoot.headers.get('location'), `${prefix}/`);
    const appRoot = await fetch(`${running.url}${prefix}/`);
    assert.equal(appRoot.status, 200);
    assert.match(await appRoot.text(), /\/youtube_overlay\/assets\//);
    const director=await connect(running.url,{claimAs:'director'}),output=await connect(running.url);clients.push(director.socket,output.socket);
    const asset={id:'test',title:'Persistent graphic',fullUrl:`${prefix}/test-graphic.svg`,source:'Built in'};
    assert.equal((await command(director.socket,'program:set-video',{videoId:'aqz-KE-bpKQ'})).ok,true);
    assert.equal((await state(output.socket)).videoId,'aqz-KE-bpKQ');
    const before=await state(output.socket);
    for(const payload of [null,{}, {videoId:'bad'}, {videoId:12}]) assert.equal((await command(director.socket,'program:set-video',payload)).ok,false);
    assert.equal((await command(director.socket,'program:take',{asset:{...asset,fullUrl:'javascript:alert(1)'}})).ok,false);
    assert.deepEqual(await state(output.socket),before);
    // A non-function acknowledgement is a malformed client payload, not a process failure.
    director.socket.emit('program:live','not-a-function'); await state(output.socket);
    for(let i=0;i<10;i++){ assert.equal((await command(director.socket,'program:take',{asset})).ok,true);assert.equal((await command(director.socket,'program:live')).ok,true); }
    await command(director.socket,'program:take',{asset}); const saved=await state(output.socket);
    const res=await fetch(`${running.url}${prefix}/api/library/favorite`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({asset,favorite:true})}); assert.equal(res.status,200);
    assert.equal((await fetch(`${running.url}${prefix}/api/images/search?q=x`)).status,400);
    assert.equal((await fetch(`${running.url}${prefix}/api/library/favorite`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{'})).status,400);
    output.socket.disconnect(); output.socket.connect(); await new Promise<void>(resolve=>output.socket.once('connect',()=>resolve())); assert.deepEqual(await state(output.socket),saved);
    clients.forEach(client=>client.disconnect());await stop(running.child); running=await start(path.join(dir,'db.sqlite'));
    const restored=await connect(running.url,{claimAs:'director'});clients.push(restored.socket);assert.deepEqual(restored.state,saved);
    const library=await (await fetch(`${running.url}${prefix}/api/library`)).json();assert.equal(library.favorites[0].asset.id,'test');assert.equal(library.recent[0].useCount,11);
    assert.equal((await command(restored.socket,'program:live')).ok,true);
  } finally {clients.forEach(client=>client.disconnect());if(running?.child.exitCode===null) await stop(running.child);rmSync(dir,{recursive:true,force:true});}
});
test('SQLite startup failure cannot disable LIVE or TAKE', {timeout:15000},async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'overlay-failure-'));const running=await start(dir);let socket:Socket|undefined;
  try { const connected=await connect(running.url,{claimAs:'director'});socket=connected.socket;
    assert.equal((await fetch(`${running.url}${prefix}/api/library`)).status,503);
    assert.equal((await command(socket,'program:take',{asset:{id:'fallback',title:'Fallback',fullUrl:`${prefix}/test-graphic.svg`}})).ok,true);
    assert.equal((await command(socket,'program:live')).ok,true);
    const health=await (await fetch(`${running.url}${prefix}/api/healthz`)).json();assert.equal(health.ok,true);assert.equal(health.persistence,'unavailable');
  } finally {socket?.disconnect();await stop(running.child);rmSync(dir,{recursive:true,force:true});}
});

test('shared playback socket commands, TV timing, stale rejection and paused restart recovery', {timeout:30000}, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'overlay-playback-server-'));
  let running: Awaited<ReturnType<typeof start>> | undefined; const clients: Socket[] = [];
  try {
    running = await start(path.join(dir, 'db.sqlite'));
    const director = await connect(running.url,{claimAs:'director'}), output = await connect(running.url); clients.push(director.socket, output.socket);
    const videoId = 'aqz-KE-bpKQ';
    await command(director.socket, 'program:set-video', { videoId });
    const control = async (action: PlaybackCommand['action'], values: { position?: number; seconds?: number } = {}) => {
      const current = await state(director.socket);
      return command(director.socket, 'program:playback', { videoId, playbackRevision: current.playback.revision, action, ...values });
    };
    assert.equal((await control('pause')).ok, false);
    assert.equal((await control('seek', { position: 300 })).ok, true);
    const current = await state(output.socket);
    const report = new Promise<OutputPlayback>(resolve => director.socket.once('playback:output', resolve));
    output.socket.emit('playback:report', { videoId, playbackRevision: current.playback.revision, currentTime: 270, duration: 600, playerState: 1, status: 'Playing' });
    assert.equal((await report).currentTime, 270);
    assert.equal((await control('pause', { position: 100 })).ok, true);
    const paused = await state(output.socket);
    assert.equal(paused.playback.status, 'paused'); assert.ok(paused.playback.position >= 270 && paused.playback.position < 272);
    assert.equal((await control('seek', { position: 555 })).ok, true);
    assert.equal((await control('skip', { seconds: -10 })).ok, true);
    let next = await state(output.socket); assert.equal(next.playback.position, 545); assert.equal(next.playback.status, 'paused');
    assert.equal((await command(director.socket, 'program:playback', { videoId, playbackRevision: current.playback.revision, action: 'seek', position: 1 })).ok, false);
    for (const payload of [null, {}, { videoId, action: 'seek', position: -5 }]) assert.equal((await command(director.socket, 'program:playback', payload)).ok, false);
    for (const payload of [null, {}, { videoId, playbackRevision: next.playback.revision, currentTime: -1, duration: 600, playerState: 1, status: 'bad' }]) output.socket.emit('playback:report', payload);
    assert.deepEqual(await state(output.socket), next);
    await command(director.socket, 'program:take', { asset: { id: 'graphic', title: 'Graphic', fullUrl: '/test-graphic.svg' } });
    await command(director.socket, 'program:live');
    assert.deepEqual((await state(output.socket)).playback, next.playback);
    const saved = await state(output.socket);
    clients.forEach(client => client.disconnect()); await stop(running.child); running = await start(path.join(dir, 'db.sqlite'));
    const restored = await connect(running.url); clients.push(restored.socket);
    assert.deepEqual(restored.state, saved);
  } finally {
    clients.forEach(client => client.disconnect()); if (running?.child.exitCode === null) await stop(running.child); rmSync(dir, { recursive: true, force: true });
  }
});

test('presentation socket TAKE validates layouts and restores settings independently of playback', { timeout: 20000 }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'overlay-presentation-server-')); const clients: Socket[] = [];
  let running: Awaited<ReturnType<typeof start>> | undefined;
  try {
    running = await start(path.join(dir, 'db.sqlite'));
    const director = await connect(running.url,{claimAs:'director'}), output = await connect(running.url); clients.push(director.socket, output.socket);
    const asset = { id: 'test', title: 'Test graphic', fullUrl: `${prefix}/test-graphic.svg` };
    const presentation = { layout: 'image', corner: 'top-left', size: 'large', transition: 'slide', fit: 'cover' };
    assert.equal((await command(director.socket, 'program:take', { asset, presentation })).ok, true);
    const saved = await state(output.socket); assert.deepEqual(saved.presentation, presentation);
    assert.equal((await command(director.socket, 'program:take', { asset, presentation: { ...presentation, layout: 'invalid' } })).ok, false);
    assert.deepEqual(await state(output.socket), saved);
    await command(director.socket, 'program:live'); const live = await state(output.socket);
    assert.equal(live.activeAsset, null); assert.deepEqual(live.presentation, presentation); assert.deepEqual(live.playback, saved.playback);
    clients.forEach(client => client.disconnect()); await stop(running.child); running = await start(path.join(dir, 'db.sqlite'));
    const restored = await connect(running.url); clients.push(restored.socket); assert.deepEqual(restored.state, live);
  } finally { clients.forEach(client => client.disconnect()); if (running?.child.exitCode === null) await stop(running.child); rmSync(dir, { recursive: true, force: true }); }
});

test('phone invites are source-specific and a disconnected on-air camera returns to saved YouTube', { timeout: 20000 }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'overlay-input-server-'));
  const running = await start(path.join(dir, 'db.sqlite'));
  const clients: Socket[] = [];
  try {
    const director = await connect(running.url,{claimAs:'director'}), output = await connect(running.url), phone = await connect(running.url);
    clients.push(director.socket, output.socket, phone.socket);
    assert.equal((await command(output.socket, 'input:invites')).ok, false);
    const invites = await new Promise<{ ok: boolean; links: Record<string, string> }>(resolve => director.socket.timeout(3000).emit('input:invites', (_error: Error | null, result: { ok: boolean; links: Record<string, string> }) => resolve(result)));
    assert.equal(invites.ok, true);
    assert.deepEqual(Object.keys(invites.links).sort(), ['phone1', 'phone2', 'phone3', 'phone4']);
    const first = new URL(invites.links.phone1, running.url);
    const second = new URL(invites.links.phone2, running.url);
    assert.equal(first.pathname, `${prefix}/phone`);
    assert.notEqual(first.searchParams.get('token'), second.searchParams.get('token'));
    const token = first.searchParams.get('token');
    assert.ok(token);
    for (const invalid of [null, {}, 123, 'é'.repeat(token.length), 'x'.repeat(token.length)]) {
      assert.equal((await command(phone.socket, 'input:join', { source: 'phone1', token: invalid })).ok, false);
    }
    assert.equal((await command(phone.socket, 'input:join', { source: 'phone2', token })).ok, false);
    assert.equal((await command(phone.socket, 'input:join', { source: 'phone1', token })).ok, true);
    assert.equal((await command(output.socket, 'input:watch', { source: 'phone1', kind: 'video' })).ok, false);
    await command(director.socket, 'program:set-video', { videoId: 'aqz-KE-bpKQ' });
    let current = await state(director.socket);
    await command(director.socket, 'program:playback', { videoId: current.videoId, playbackRevision: current.playback.revision, action: 'seek', position: 88 });
    assert.equal((await command(director.socket, 'program:set-source', { source: 'phone1' })).ok, true);
    current = await state(output.socket);
    assert.equal(current.source, 'phone1');
    assert.equal((await command(output.socket, 'input:watch', { source: 'phone2', kind: 'video' })).ok, false);
    assert.equal((await command(output.socket, 'input:watch', { source: 'phone1', kind: 'video' })).ok, true);
    assert.equal((await command(director.socket, 'program:set-source', { source: 'youtube' })).ok, true);
    assert.equal((await command(output.socket, 'input:signal', { source: 'phone1', kind: 'video', to: phone.socket.id, data: { type: 'candidate', candidate: { candidate: 'test' } } })).ok, false);
    assert.equal((await command(director.socket, 'program:set-source', { source: 'phone1' })).ok, true);
    const fallback = new Promise<ProgramState>(resolve => {
      const onState = (next: ProgramState) => { if (next.source === 'youtube') { output.socket.off('program:state', onState); resolve(next); } };
      output.socket.on('program:state', onState);
    });
    phone.socket.disconnect();
    const restored = await fallback;
    assert.equal(restored.videoId, 'aqz-KE-bpKQ');
    assert.ok(restored.playback.position !== null && restored.playback.position >= 88);
  } finally { clients.forEach(client => client.disconnect()); await stop(running.child); rmSync(dir, { recursive: true, force: true }); }
});

test('production Webapps SSO protects Director actions while Output stays public across restart', { timeout: 20000 }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'overlay-director-sso-'));
  const data = path.join(dir, 'db.sqlite');
  let running = await start(data, { NODE_ENV: 'production' });
  const clients: Socket[] = [];
  try {
    const visitor = await connect(running.url, { extraHeaders: { 'X-Auth-Request-User': 'spoofed@example.test' } });
    const director = await connect(running.url);
    clients.push(visitor.socket, director.socket);
    assert.equal((await fetch(`${running.url}${prefix}/output`)).status, 200);
    assert.equal((await fetch(`${running.url}${prefix}/phone`)).status, 200);
    assert.equal((await fetch(`${running.url}${prefix}/`)).status, 200);
    assert.equal((await fetch(`${running.url}${prefix}/director`)).status, 401);
    assert.equal((await command(visitor.socket, 'input:invites')).ok, false);
    assert.equal((await command(visitor.socket, 'input:join-director', { source: 'director' })).ok, false);
    assert.equal((await command(visitor.socket, 'program:set-source', { source: 'youtube' })).ok, false);
    assert.equal((await command(visitor.socket, 'program:set-audio', { source: 'youtube', muted: true })).ok, false);
    for (const [event, payload] of [
      ['program:set-video', { videoId: 'aqz-KE-bpKQ' }],
      ['program:take', { asset: { id: 'private', title: 'Private', fullUrl: `${prefix}/test-graphic.svg` } }],
      ['program:live', undefined], ['program:force-sync', undefined],
    ] as const) assert.equal((await command(visitor.socket, event, payload)).ok, false);
    assert.equal((await fetch(`${running.url}${prefix}/api/healthz`)).status, 200);
    assert.equal((await fetch(`${running.url}${prefix}/api/library`)).status, 401);
    const missingIdentity = await claimDirector(running.url, director.socket);
    assert.equal(missingIdentity.status, 401);
    assert.equal(missingIdentity.ok, undefined);
    const claimed = await claimDirector(running.url, director.socket, 'director@example.test');
    assert.equal(claimed.ok, true);
    assert.equal(claimed.user, 'director@example.test');
    assert.equal((await fetch(`${running.url}${prefix}/director`, { headers: { 'X-Auth-Request-User': 'director@example.test' } })).status, 200);
    assert.equal((await fetch(`${running.url}${prefix}/api/library`, { headers: { 'X-Auth-Request-User': 'director@example.test' } })).status, 200);
    // A forged Socket.IO handshake header is not an SSO-backed HTTP claim.
    assert.equal((await command(visitor.socket, 'program:set-video', { videoId: 'aqz-KE-bpKQ' })).ok, false);
    assert.equal((await command(director.socket, 'input:invites')).ok, true);
    assert.equal((await command(director.socket, 'program:set-video', { videoId: 'aqz-KE-bpKQ' })).ok, true);
    const playing = await state(visitor.socket);
    assert.equal((await command(visitor.socket, 'program:playback', { videoId: playing.videoId, playbackRevision: playing.playback.revision, action: 'seek', position: 12 })).ok, false);
    assert.equal((await command(director.socket, 'program:playback', { videoId: playing.videoId, playbackRevision: playing.playback.revision, action: 'seek', position: 12 })).ok, true);
    assert.equal((await command(director.socket, 'program:set-audio', { source: 'youtube', muted: true })).ok, true);
    clients.forEach(client => client.disconnect()); await stop(running.child);
    running = await start(data, { NODE_ENV: 'production' });
    const restored = await connect(running.url); clients.push(restored.socket);
    assert.equal((await command(restored.socket, 'input:invites')).ok, false);
    assert.equal((await claimDirector(running.url, restored.socket, 'director@example.test')).ok, true);
    assert.equal((await command(restored.socket, 'input:invites')).ok, true);
    assert.equal(existsSync(path.join(dir, 'director-access-key')), false);
  } finally { clients.forEach(client => client.disconnect()); if (running.child.exitCode === null) await stop(running.child); rmSync(dir, { recursive: true, force: true }); }
});

test('expired SSO socket claims stop authorizing Director mutations until renewed', { timeout: 12000 }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'overlay-director-lease-'));
  const running = await start(path.join(dir, 'db.sqlite'), { NODE_ENV: 'production', DIRECTOR_CLAIM_TTL_MS: '200' });
  const director = await connect(running.url);
  try {
    assert.equal((await claimDirector(running.url, director.socket, 'director@example.test')).ok, true);
    assert.equal((await command(director.socket, 'program:set-video', { videoId: 'aqz-KE-bpKQ' })).ok, true);
    await wait(350);
    assert.equal((await command(director.socket, 'program:live')).ok, false);
    assert.equal((await claimDirector(running.url, director.socket, 'director@example.test')).ok, true);
    assert.equal((await command(director.socket, 'program:live')).ok, true);
  } finally { director.socket.disconnect(); await stop(running.child); rmSync(dir, { recursive: true, force: true }); }
});

test('WebRTC relay enforces registered source and media pairs through audio/video handoffs', { timeout: 20000 }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'overlay-relay-'));
  const running = await start(path.join(dir, 'db.sqlite'));
  const clients: Socket[] = [];
  try {
    const connections = await Promise.all(Array.from({ length: 5 }, (_, index) => connect(running.url, index === 0 ? { claimAs: 'director' } : {})));
    const [director, output, first, second, visitor] = connections.map(connection => connection.socket);
    clients.push(...connections.map(connection => connection.socket));
    const invites = await command(director, 'input:invites') as CommandAck & { links: Record<string, string> };
    for (const [source, phone] of [['phone1', first], ['phone2', second]] as const) {
      const token = new URL(invites.links[source], running.url).searchParams.get('token');
      assert.equal((await command(phone, 'input:join', { source, token })).ok, true);
      assert.equal((await command(visitor, 'input:join', { source, token })).ok, false);
    }
    await command(director, 'program:set-video', { videoId: 'aqz-KE-bpKQ' });
    await command(director, 'program:set-source', { source: 'phone1' });
    assert.equal((await command(output, 'input:watch', { source: 'phone1', kind: 'video' })).ok, true);
    const offer = { source: 'phone1', kind: 'video', to: output.id, data: { type: 'offer', sdp: 'test-offer' } };
    const relayed = new Promise<Record<string, unknown>>(resolve => output.once('input:signal', resolve));
    assert.equal((await command(first, 'input:signal', offer)).ok, true);
    assert.deepEqual(await relayed, { source: 'phone1', kind: 'video', from: first.id, data: offer.data });
    assert.equal((await command(visitor, 'input:signal', offer)).ok, false);
    assert.equal((await command(first, 'input:signal', { ...offer, kind: 'audio' })).ok, false);
    assert.equal((await command(first, 'input:signal', { ...offer, to: second.id })).ok, false);
    for (const data of [null, {}, { type: 'offer', sdp: 'x'.repeat(28001) }, { type: 'candidate', candidate: { candidate: 123 } }]) {
      assert.equal((await command(first, 'input:signal', { ...offer, data })).ok, false);
    }
    await command(director, 'program:set-audio', { followSelected: false, audioSource: 'phone2' });
    assert.equal((await command(output, 'input:watch', { source: 'phone2', kind: 'video' })).ok, false);
    assert.equal((await command(output, 'input:watch', { source: 'phone2', kind: 'audio' })).ok, true);
    const audioOffer = { ...offer, source: 'phone2', kind: 'audio' };
    assert.equal((await command(second, 'input:signal', audioOffer)).ok, true);
    await command(director, 'program:set-source', { source: 'phone2' });
    assert.equal((await command(first, 'input:signal', offer)).ok, false);
    // The same viewer needs independent video and microphone subscriptions.
    assert.equal((await command(output, 'input:watch', { source: 'phone2', kind: 'video' })).ok, true);
    assert.equal((await command(second, 'input:signal', audioOffer)).ok, true);
    output.emit('input:unwatch', { source: 'phone2', kind: 'audio' });
    await state(output);
    assert.equal((await command(second, 'input:signal', { ...audioOffer, kind: 'video' })).ok, true);
    assert.equal((await command(second, 'input:signal', audioOffer)).ok, false);
    assert.equal((await command(output, 'input:watch', { source: 'phone2', kind: 'audio' })).ok, true);
    assert.equal((await command(second, 'input:signal', audioOffer)).ok, true);
    await command(director, 'program:set-audio', { source: 'phone2', muted: true });
    assert.equal((await command(second, 'input:signal', audioOffer)).ok, false);
    assert.equal((await command(output, 'input:watch', { source: 'phone2', kind: 'audio' })).ok, false);
    assert.equal((await command(second, 'input:signal', { ...audioOffer, kind: 'video' })).ok, true);
    await command(director, 'program:set-audio', { source: 'phone2', muted: false, volume: 0 });
    assert.equal((await command(output, 'input:watch', { source: 'phone2', kind: 'audio' })).ok, false);
    output.emit('input:unwatch', { source: 'phone2', kind: 'video' });
    // Use an acknowledged request on the same socket to order its unwatch.
    await state(output);
    assert.equal((await command(second, 'input:signal', { ...audioOffer, kind: 'video' })).ok, false);
  } finally { clients.forEach(client => client.disconnect()); await stop(running.child); rmSync(dir, { recursive: true, force: true }); }
});
