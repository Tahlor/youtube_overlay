import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import http from 'node:http';
import { WikimediaProvider, OpenverseProvider } from '../server/imageProvider.js';
import { createImageSearchRouter } from '../server/imageSearch.js';

function commonsData(id: number, more = false) {
  return { ...(more ? { continue: { gsroffset: 12 } } : {}), query: { pages: { [id]: { pageid: id, title: `File:Image${id}.jpg`, imageinfo: [{ url: `https://upload.wikimedia.org/${id}.jpg`, thumburl: `https://thumb.wikimedia.org/${id}.jpg`, descriptionurl: `https://commons.wikimedia.org/wiki/File:Image${id}.jpg`, mime: 'image/jpeg' }] } } } };
}
function openverseData() {
  return { page: 1, page_count: 1, results: [{ id: 'other', title: 'Other image', url: 'https://images.example/other.jpg', thumbnail: 'https://images.example/other-small.jpg', foreign_landing_url: 'https://example.com/other', creator: 'Creator', license: 'cc0', license_version: '1.0', license_url: 'https://creativecommons.org/publicdomain/zero/1.0/' }] };
}
async function fixture(commonsRequest: typeof fetch, openverseRequest: typeof fetch) {
  const app = express(); app.use('/images', createImageSearchRouter({ commons: new WikimediaProvider(commonsRequest), openverse: new OpenverseProvider(openverseRequest) }));
  const server = http.createServer(app); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  return { url: `http://127.0.0.1:${address.port}/images`, close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }) };
}
function lines(value: string): Record<string, any>[] { return value.trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }

test('search streams the first provider before the second finishes, then paginates without restarting exhausted sources', { timeout: 10000 }, async () => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let openverseCalls = 0;
  const commonsCalls: number[] = [];
  const running = await fixture((async url => {
    const offset = Number(new URL(String(url)).searchParams.get('gsroffset') ?? 0); commonsCalls.push(offset);
    return Response.json(commonsData(offset ? 2 : 1, offset === 0));
  }) as typeof fetch, (async () => { openverseCalls++; await gate; return Response.json(openverseData()); }) as typeof fetch);
  try {
    const response = await fetch(`${running.url}/search/stream?q=temple&provider=all`);
    assert.equal(response.headers.get('content-type')?.includes('application/x-ndjson'), true);
    assert.equal(response.headers.get('x-accel-buffering'), 'no');
    const reader = response.body!.getReader(); let text = ''; const decoder = new TextDecoder();
    while (!text.includes('"type":"provider"')) { const chunk = await reader.read(); assert.equal(chunk.done, false); text += decoder.decode(chunk.value, { stream: true }); }
    const first = lines(text).find(event => event.type === 'provider'); assert.equal(first?.provider, 'commons');
    assert.ok(first?.assets.length); assert.equal(text.includes('"type":"done"'), false);
    release();
    for (;;) { const chunk = await reader.read(); if (chunk.done) break; text += decoder.decode(chunk.value, { stream: true }); }
    const events = lines(text); assert.equal(events.filter(event => event.type === 'provider').length, 2);
    const done = events.find(event => event.type === 'done'); assert.equal(done?.hasMore, true); assert.ok(done?.cursor);
    const next = lines(await (await fetch(`${running.url}/search/stream?q=temple&provider=all&cursor=${done!.cursor}`)).text());
    assert.equal(next.filter(event => event.type === 'provider').length, 1); assert.equal(next.find(event => event.type === 'provider')?.assets[0].id, 'commons:2');
    assert.equal(openverseCalls, 1); assert.deepEqual(commonsCalls, [0, 12]);
    assert.equal(next.find(event => event.type === 'done')?.hasMore, false);
    assert.equal((await fetch(`${running.url}/search/stream?q=mountain&provider=all&cursor=${done!.cursor}`)).status, 400);
    const invalid = Buffer.from(JSON.stringify({ v: 1, query: 'temple', provider: 'commons', positions: { commons: -1 } })).toString('base64url');
    assert.equal((await fetch(`${running.url}/search/stream?q=temple&provider=commons&cursor=${invalid}`)).status, 400);
    assert.equal((await fetch(`${running.url}/search/stream?q=x`)).status, 400);
    assert.equal((await fetch(`${running.url}/search/stream?q=temple&provider=invalid`)).status, 400);
  } finally { release(); await running.close(); }
});

test('partial provider failure preserves usable results and exposes an explicit source error', async () => {
  const running = await fixture((async () => Response.json(commonsData(1))) as typeof fetch, (async () => Response.json({}, { status: 429 })) as typeof fetch);
  try {
    const events = lines(await (await fetch(`${running.url}/search/stream?q=temple`)).text());
    assert.equal(events.find(event => event.provider === 'commons')?.assets.length, 1);
    assert.match(events.find(event => event.provider === 'openverse')?.error, /429/);
    const done = events.find(event => event.type === 'done'); assert.equal(done?.providers.find((p: any) => p.provider === 'openverse').status, 'error');
    const legacy = await (await fetch(`${running.url}/search?q=temple`)).json(); assert.equal(legacy.assets.length, 1);
  } finally { await running.close(); }
});

test('disconnecting a search stream aborts unfinished provider requests', { timeout: 10000 }, async () => {
  let aborted!: () => void; const abortObserved = new Promise<void>(resolve => { aborted = resolve; });
  const running = await fixture((async () => Response.json(commonsData(1))) as typeof fetch, (async (_url, options) => new Promise((_resolve, reject) => {
    options?.signal?.addEventListener('abort', () => { aborted(); reject(new Error('Aborted')); }, { once: true });
  })) as typeof fetch);
  try {
    const response = await fetch(`${running.url}/search/stream?q=temple`); const reader = response.body!.getReader(); await reader.read(); await reader.cancel(); await abortObserved;
  } finally { await running.close(); }
});
