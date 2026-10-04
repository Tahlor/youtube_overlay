import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { Asset } from '../src/shared/types.js';
import { normalizeAsset } from '../src/shared/asset.js';
import type { ImageProvider, ImageSearchPage } from './imageProvider.js';

const PAGE_SIZE = 24;
const MAX_TOKENS = 8;
const STOPWORDS = new Set(['a', 'an', 'the', 'of', 'and', 'or', 'in', 'on', 'at', 'to', 'with', 'for', 'is', 'by']);

type Row = { id: string; slug: string; title: string; description: string; alt_text: string; source_url: string; collections: string; file: string };

/** Local index of the Church Media Library built by scripts/crawl-lds-media.mjs. */
export class LdsLibraryProvider implements ImageProvider {
  private db: DatabaseSync | null = null;

  /** @param mediaUrl URL prefix (app path) under which `<dir>/images` and `<dir>/thumbs` are served. */
  constructor(private dbPath: string, private mediaUrl: string) {}

  /** True once the crawler has produced an index. */
  get available(): boolean { return existsSync(this.dbPath); }

  async search(query: string): Promise<Asset[]> {
    return (await this.searchPage(query, 0)).assets;
  }

  async searchPage(query: string, page: number): Promise<ImageSearchPage> {
    const offset = Number.isSafeInteger(page) && page >= 0 ? page : 0;
    const match = toMatchExpression(query);
    const db = this.open();
    if (!match || !db) return { assets: [], nextPage: null };
    const rows = db.prepare(`
      SELECT i.id, i.slug, i.title, i.description, i.alt_text, i.source_url, i.collections, i.file
      FROM lds_fts f JOIN lds_images i ON i.id = f.id
      WHERE lds_fts MATCH ? AND i.file IS NOT NULL
      ORDER BY bm25(lds_fts, 0, 10, 3, 2, 1), i.id
      LIMIT ? OFFSET ?`).all(match, PAGE_SIZE + 1, offset) as Row[];
    const assets = rows.slice(0, PAGE_SIZE).flatMap(row => {
      try { return [this.toAsset(row)]; } catch { return []; }
    });
    return { assets, nextPage: rows.length > PAGE_SIZE ? offset + PAGE_SIZE : null };
  }

  private toAsset(row: Row): Asset {
    const base = this.mediaUrl.replace(/\/$/, '');
    return normalizeAsset({
      id: 'lds:' + row.id,
      title: displayTitle(row),
      fullUrl: `${base}/images/${row.file}`,
      thumbnailUrl: `${base}/thumbs/${row.file}`,
      source: 'Church Media Library',
      sourceUrl: row.source_url,
      author: 'The Church of Jesus Christ of Latter-day Saints',
      license: 'Church media · personal/home use',
    });
  }

  private open(): DatabaseSync | null {
    if (this.db) return this.db;
    if (!this.available) return null;
    try {
      const db = new DatabaseSync(this.dbPath, { readOnly: true });
      db.exec('PRAGMA busy_timeout = 3000');
      this.db = db;
    } catch { /* crawler may still be creating the index */ }
    return this.db;
  }
}

function toMatchExpression(query: string): string {
  const tokens = (query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter(token => !STOPWORDS.has(token))
    .slice(0, MAX_TOKENS);
  // OR + bm25: images matching every word rank first, partial matches still appear.
  return tokens.map(token => `"${token}"*`).join(' OR ');
}

function displayTitle(row: Row): string {
  const title = row.title.trim();
  if (title && !/^no title$/i.test(title)) return title.slice(0, 500);
  const fallback = (row.alt_text || row.description || row.collections.split('|')[0] || 'Church image').trim();
  return fallback.slice(0, 120);
}
