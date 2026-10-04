import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import express from 'express';
import { LdsLibraryProvider } from '../server/ldsLibrary.js';
import { createImageSearchRouter } from '../server/imageSearch.js';

function makeIndex() {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'lds-')), 'lds.sqlite');
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE lds_images (id TEXT PRIMARY KEY, slug TEXT, title TEXT, description TEXT, alt_text TEXT, source_url TEXT, collections TEXT, width INT, height INT, file TEXT, fetched_at TEXT);
    CREATE VIRTUAL TABLE lds_fts USING fts5(id UNINDEXED, title, description, alt_text, collections);`);
  const add = (id: string, title: string, description: string, file: string | null) => {
    db.prepare('INSERT INTO lds_images VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id, id, title, description, '', 'https://example.test/' + id, 'Gospel Art Book', 1, 1, file, 'now');
    db.prepare('INSERT INTO lds_fts VALUES (?,?,?,?,?)').run(id, title, description, '', 'Gospel Art Book');
  };
  add('a', 'Christ Blessing the Children', 'Jesus blesses little children', 'a.jpg');
  add('b', 'No Title', 'A temple at sunset', 'b.jpg');
  add('c', 'Pending download', 'children playing', null);
  db.close();
  return file;
}

test('LDS provider ranks title matches, skips undownloaded files and fixes up titles', async () => {
  const provider = new LdsLibraryProvider(makeIndex(), '/base/lds-media');
  const children = await provider.searchPage('the children', 0);
  assert.deepEqual(children.assets.map(a => a.id), ['lds:a']);
  assert.equal(children.assets[0].thumbnailUrl, '/base/lds-media/thumbs/a.jpg');
  assert.equal(children.assets[0].fullUrl, '/base/lds-media/images/a.jpg');
  assert.equal(children.nextPage, null);
  const temple = await provider.searchPage('temple', 0);
  assert.equal(temple.assets[0].title, 'A temple at sunset');
  assert.deepEqual((await provider.searchPage('!!', 0)).assets, []);
});

test('router exposes lds only when configured and streams it first', async () => {
  const app = express();
  app.use('/images', createImageSearchRouter({ lds: new LdsLibraryProvider(makeIndex(), '/m'), commons: { searchPage: async () => ({ assets: [], nextPage: null }), search: async () => [] } as never, openverse: { searchPage: async () => ({ assets: [], nextPage: null }), search: async () => [] } as never }));
  const server = app.listen(0); const { port } = server.address() as { port: number };
  try {
    const sources = await (await fetch(`http://127.0.0.1:${port}/images/sources`)).json();
    assert.deepEqual(sources.sources, ['lds', 'commons', 'openverse']);
    const text = await (await fetch(`http://127.0.0.1:${port}/images/search/stream?q=children&provider=lds`)).text();
    const events = text.trim().split('\n').map(line => JSON.parse(line));
    assert.equal(events.find(e => e.type === 'provider').assets[0].id, 'lds:a');
  } finally { server.close(); }
});
