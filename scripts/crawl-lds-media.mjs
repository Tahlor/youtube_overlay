#!/usr/bin/env node
// Crawls the Church Media Library (personal/home use) into data/lds/.
//   node scripts/crawl-lds-media.mjs [--no-download] [--max-images N] [--delay ms] [--root slug]
// Uses the site's own JSON endpoint (/media/api/getcollection) that powers the collection pages.
// Resumable: already-indexed images are skipped; already-downloaded files are kept.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'https://www.churchofjesuschrist.org';
const args = process.argv.slice(2);
const flag = (n) => args.includes('--' + n);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const DOWNLOAD = !flag('no-download');
const MAX_IMAGES = Number(opt('max-images', Infinity));
const DELAY_MS = Number(opt('delay', 250));
const ROOT = opt('root', 'image-collections');
const PAGE = 50;
const OUT = join(process.cwd(), 'data', 'lds');
const FILES = join(OUT, 'images');
const THUMBS = join(OUT, 'thumbs');
mkdirSync(FILES, { recursive: true });
mkdirSync(THUMBS, { recursive: true });

const db = new DatabaseSync(join(OUT, 'lds.sqlite'));
db.exec(`CREATE TABLE IF NOT EXISTS lds_images (
  id TEXT PRIMARY KEY, slug TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  alt_text TEXT NOT NULL DEFAULT '', source_url TEXT NOT NULL, collections TEXT NOT NULL DEFAULT '',
  width INTEGER, height INTEGER, file TEXT, fetched_at TEXT NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS lds_fts USING fts5(id UNINDEXED, title, description, alt_text, collections);`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (personal family project)' }, signal: AbortSignal.timeout(30000) });
      if (res.ok) return res;
      if (res.status === 404 || res.status === 400) return null;
    } catch { /* retry */ }
    await sleep(1000 * 2 ** i);
  }
  throw new Error('Failed: ' + url);
}

// 1. Walk collections (BFS) via the JSON API, paginating each.
const seen = new Set();
const images = new Map(); // id -> { item, cols:Set }
const queue = [{ slug: ROOT, title: ROOT }];
while (queue.length) {
  const { slug, title: parentTitle } = queue.shift();
  if (seen.has(slug)) continue;
  seen.add(slug);
  let offset = 0, total = Infinity, nImg = 0, nSub = 0, title = parentTitle;
  while (offset < total) {
    const res = await get(`${BASE}/media/api/getcollection?offset=${offset}&limit=${PAGE}&uri=${encodeURIComponent(slug)}&lang=eng`);
    const data = res && await res.json().catch(() => null);
    if (!data?.items?.length) break;
    total = data.total ?? data.items.length;
    title = data.title || title;
    for (const it of data.items) {
      if (it.type === 'image') {
        if (!images.has(it.id)) images.set(it.id, { item: it, cols: new Set() });
        images.get(it.id).cols.add(title);
        nImg++;
      } else if (it.type === 'collection') {
        const sub = it.href?.match(/\/collection\/([a-z0-9-]+)/)?.[1];
        if (sub && !seen.has(sub)) { queue.push({ slug: sub, title: it.title ?? sub }); nSub++; }
      }
    }
    offset += data.items.length;
    await sleep(DELAY_MS);
  }
  console.log(`[collection] ${slug}: ${nImg} images, ${nSub} subcollections (unique images ${images.size}, queue ${queue.length})`);
}
console.log(`Discovered ${images.size} unique images in ${seen.size} collections.`);

// 2. Save metadata + download files.
const have = new Set(db.prepare('SELECT id FROM lds_images').all().map((r) => r.id));
const upsert = db.prepare(`INSERT OR REPLACE INTO lds_images
  (id,slug,title,description,alt_text,source_url,collections,width,height,file,fetched_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
const delFts = db.prepare('DELETE FROM lds_fts WHERE id=?');
const insFts = db.prepare('INSERT INTO lds_fts (id,title,description,alt_text,collections) VALUES (?,?,?,?,?)');
let n = 0;
for (const [id, { item, cols }] of images) {
  if (n >= MAX_IMAGES) break;
  const file = join(FILES, id + '.jpg');
  const thumb = join(THUMBS, id + '.jpg');
  if (have.has(id) && (!DOWNLOAD || (existsSync(file) && existsSync(thumb)))) continue;
  try {
    const large = item.downloads?.find((d) => d.downloadType === 'LARGE') ?? item.downloads?.at(-1);
    const [w, h] = (large?.dimensions ?? '').split('x').map(Number);
    if (DOWNLOAD && !existsSync(file)) {
      const url = (large?.url ?? `${BASE}/imgs/${id}/full/!1920,/0/default`).replace(/\?download=true$/, '');
      const res = await get(url);
      if (!res) throw new Error('image 404');
      writeFileSync(file + '.part', Buffer.from(await res.arrayBuffer()));
      renameSync(file + '.part', file);
    }
    if (DOWNLOAD && !existsSync(thumb)) {
      const res = await get(`${BASE}/imgs/${id}/full/!480,/0/default`);
      if (res) { writeFileSync(thumb + '.part', Buffer.from(await res.arrayBuffer())); renameSync(thumb + '.part', thumb); }
    }
    const slug = item.href?.match(/\/image\/([^?]+)/)?.[1] ?? id;
    const collections = [...cols].join(' | ');
    upsert.run(id, slug, item.title ?? slug, item.description ?? '', item.altText ?? '', `${BASE}/media/image/${slug}?lang=eng`,
      collections, w || null, h || null, DOWNLOAD ? id + '.jpg' : null, new Date().toISOString());
    delFts.run(id); insFts.run(id, item.title ?? slug, item.description ?? '', item.altText ?? '', collections);
    n++;
    if (n % 50 === 0) console.log(`[image] ${n} done (last: ${item.title})`);
  } catch (e) { console.warn('[error]', id, e.message); }
  await sleep(DELAY_MS);
}
const total = db.prepare('SELECT COUNT(*) c FROM lds_images').get().c;
console.log(`Done. ${n} new, ${total} total in ${join(OUT, 'lds.sqlite')}`);
