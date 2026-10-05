import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Asset, Library, LibraryAsset, ProgramState } from '../src/shared/types.js';
import { normalizeAsset } from '../src/shared/asset.js';

export class LibraryStore {
  private db: DatabaseSync;
  constructor(filename: string) {
    mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=1000;
      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY, asset TEXT NOT NULL, favorite INTEGER NOT NULL DEFAULT 0,
        use_count INTEGER NOT NULL DEFAULT 0, last_used TEXT,
        uploaded INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS program (id INTEGER PRIMARY KEY CHECK(id=1), state TEXT NOT NULL);`);
    // Existing deployments predate the upload collection. Add the flag in place
    // without replacing or rewriting Favorites/Recent rows.
    const columns = this.db.prepare('PRAGMA table_info(assets)').all() as Record<string, unknown>[];
    if (!columns.some(column => column.name === 'uploaded')) {
      this.db.exec('ALTER TABLE assets ADD COLUMN uploaded INTEGER NOT NULL DEFAULT 0;');
    }
  }
  readProgram(): ProgramState | null {
    const row = this.db.prepare('SELECT state FROM program WHERE id=1').get();
    return row ? JSON.parse(row.state as string) as ProgramState : null;
  }
  saveProgram(state: ProgramState) {
    this.db.prepare('INSERT INTO program VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET state=excluded.state').run(JSON.stringify(state));
  }
  favorite(value: unknown, favorite: boolean) {
    const asset = normalizeAsset(value);
    this.db.prepare(`INSERT INTO assets(id,asset,favorite) VALUES(?,?,?)
      ON CONFLICT(id) DO UPDATE SET asset=excluded.asset,favorite=excluded.favorite`).run(asset.id, JSON.stringify(asset), favorite ? 1 : 0);
  }
  imported(value: unknown) {
    const asset = normalizeAsset(value);
    this.db.prepare(`INSERT INTO assets(id,asset,uploaded) VALUES(?,?,1)
      ON CONFLICT(id) DO UPDATE SET asset=excluded.asset,uploaded=1`).run(asset.id, JSON.stringify(asset));
  }
  used(asset: Asset) {
    this.db.prepare(`INSERT INTO assets(id,asset,use_count,last_used) VALUES(?,?,1,?)
      ON CONFLICT(id) DO UPDATE SET asset=excluded.asset,use_count=use_count+1,last_used=excluded.last_used`).run(asset.id, JSON.stringify(asset), new Date().toISOString());
  }
  list(): Library {
    const map = (row: Record<string, unknown>): LibraryAsset => ({
      asset: normalizeAsset(JSON.parse(row.asset as string)), favorite: row.favorite === 1,
      useCount: Number(row.use_count), lastUsed: row.last_used as string | null,
    });
    return {
      uploads: this.db.prepare('SELECT * FROM assets WHERE uploaded=1 ORDER BY rowid DESC LIMIT 100').all().map(map),
      favorites: this.db.prepare('SELECT * FROM assets WHERE favorite=1 ORDER BY id LIMIT 100').all().map(map),
      recent: this.db.prepare('SELECT * FROM assets WHERE use_count>0 ORDER BY last_used DESC, rowid DESC LIMIT 40').all().map(map),
    };
  }
  close() { this.db.close(); }
}
