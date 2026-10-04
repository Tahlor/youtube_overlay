import { Router, type Request, type Response } from 'express';
import type { Asset } from '../src/shared/types.js';
import { OpenverseProvider, WikimediaProvider, type ImageProvider } from './imageProvider.js';

export type ImageSearchProviderName = 'lds' | 'commons' | 'openverse';
export type ImageSearchProviderChoice = ImageSearchProviderName | 'all';

export interface ImageSearchRouterOptions {
  commons?: WikimediaProvider;
  openverse?: OpenverseProvider;
  /** Local Church Media Library; omitted from search when not configured. */
  lds?: ImageProvider;
}

interface CursorPayload {
  v: 1;
  query: string;
  provider: ImageSearchProviderChoice;
  positions: Partial<Record<ImageSearchProviderName, number>>;
}

interface ProviderResult {
  assets: Asset[];
  nextPage: number | null;
}

type StreamProviderEvent = {
  type: 'provider';
  provider: ImageSearchProviderName;
  assets: Asset[];
  nextCursor: string | null;
  error?: string;
};

const SEARCH_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 60;
const MAX_ACTIVE_SEARCHES = 4;
const MAX_QUERY_LENGTH = 120;
const ALL_PROVIDERS: ImageSearchProviderName[] = ['lds', 'commons', 'openverse'];

export function createImageSearchRouter(options: ImageSearchRouterOptions = {}): Router {
  const router = Router();
  const providers: Partial<Record<ImageSearchProviderName, ImageProvider>> = {
    ...(options.lds ? { lds: options.lds } : {}),
    commons: options.commons ?? new WikimediaProvider(),
    openverse: options.openverse ?? new OpenverseProvider(),
  };
  const PROVIDERS = ALL_PROVIDERS.filter(name => providers[name]);

  router.get('/sources', (_req, res) => { res.json({ sources: PROVIDERS }); });
  const cache = new Map<string, { expiresAt: number; result: ProviderResult }>();
  let activeSearches = 0;

  router.get('/search', async (req, res) => {
    const query = readQuery(req);
    if (!validQuery(query)) {
      res.status(400).json({ error: 'Enter 2–120 characters to search.' });
      return;
    }
    const cacheKey = 'legacy:' + query.toLowerCase();
    const cached = readCache(cache, cacheKey);
    if (cached) {
      res.json({ assets: cached.assets });
      return;
    }
    if (!acquire()) {
      res.status(429).json({ error: 'Image search is busy. Try again shortly.' });
      return;
    }
    try {
      const assets = await providers.commons!.search(query);
      writeCache(cache, cacheKey, { assets, nextPage: null });
      res.json({ assets });
    } catch {
      res.status(502).json({ error: 'Image search is unavailable. Try again; Preview, TAKE and LIVE still work.' });
    } finally {
      activeSearches--;
    }
  });

  router.get('/search/stream', async (req, res) => {
    const query = readQuery(req);
    const choice = readProviderChoice(req, PROVIDERS);
    if (!validQuery(query)) {
      res.status(400).json({ error: 'Enter 2–120 characters to search.' });
      return;
    }
    if (!choice) {
      res.status(400).json({ error: 'Choose all or one of: ' + PROVIDERS.join(', ') + ' as the image source.' });
      return;
    }
    const cursorText = typeof req.query.cursor === 'string' ? req.query.cursor : '';
    const cursor = cursorText ? decodeCursor(cursorText, query, choice, PROVIDERS) : undefined;
    if (cursorText && !cursor) {
      res.status(400).json({ error: 'That image search page has expired. Search again.' });
      return;
    }
    if (!acquire()) {
      res.status(429).json({ error: 'Image search is busy. Try again shortly.' });
      return;
    }

    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });
    res.status(200);
    res.set({
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Content-Type-Options': 'nosniff',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    const currentPositions = cursor?.positions ?? {};
    const requested = choice === 'all' ? PROVIDERS : [choice];
    const selected = cursor
      ? requested.filter(name => currentPositions[name] !== undefined)
      : requested;
    const nextPositions: Partial<Record<ImageSearchProviderName, number>> = {};
    const statuses = {} as Record<ImageSearchProviderName, 'ok' | 'error' | 'pending'>;
    selected.forEach(name => { statuses[name] = 'pending'; });
    const seen = new Set<string>();
    const send = (event: unknown) => {
      if (!controller.signal.aborted && !res.destroyed && !res.writableEnded) {
        res.write(JSON.stringify(event) + '\n');
      }
    };

    send({ type: 'start', query, providers: selected });
    try {
      await Promise.all(selected.map(async name => {
        const startPage = currentPositions[name] ?? (name === 'openverse' ? 1 : 0);
        const cacheKey = name + ':' + query.toLowerCase() + ':' + startPage;
        try {
          const page = await readCache(cache, cacheKey) ?? await providers[name]!.searchPage(query, startPage, controller.signal);
          writeCache(cache, cacheKey, page);
          if (page.nextPage === null) delete nextPositions[name];
          else nextPositions[name] = page.nextPage;
          statuses[name] = 'ok';
          const uniqueAssets = page.assets.filter(asset => {
            const keys = assetKeys(asset);
            if (keys.some(key => seen.has(key))) return false;
            keys.forEach(key => seen.add(key));
            return true;
          });
          const event: StreamProviderEvent = {
            type: 'provider',
            provider: name,
            assets: uniqueAssets,
            nextCursor: page.nextPage === null ? null : String(page.nextPage),
          };
          send(event);
        } catch (error) {
          if (controller.signal.aborted) return;
          statuses[name] = 'error';
          const event: StreamProviderEvent = {
            type: 'provider',
            provider: name,
            assets: [],
            nextCursor: null,
            error: error instanceof Error ? error.message.slice(0, 240) : 'Image source unavailable.',
          };
          send(event);
        }
      }));

      if (!controller.signal.aborted) {
        const hasMore = Object.keys(nextPositions).length > 0;
        const nextCursor = hasMore ? encodeCursor({
          v: 1,
          query: query.toLowerCase(),
          provider: choice,
          positions: nextPositions,
        }) : null;
        send({
          type: 'done',
          cursor: nextCursor,
          hasMore,
          providers: selected.map(provider => ({
            provider,
            status: statuses[provider] === 'pending' ? 'error' : statuses[provider],
            nextCursor: nextPositions[provider] === undefined ? null : String(nextPositions[provider]),
          })),
        });
        res.end();
      }
    } finally {
      activeSearches--;
    }
  });

  function acquire(): boolean {
    if (activeSearches >= MAX_ACTIVE_SEARCHES) return false;
    activeSearches++;
    return true;
  }

  return router;
}

function readQuery(req: Request): string {
  return typeof req.query.q === 'string' ? req.query.q.trim() : '';
}

function validQuery(query: string): boolean {
  return query.length >= 2 && query.length <= MAX_QUERY_LENGTH;
}

function readProviderChoice(req: Request, available: ImageSearchProviderName[]): ImageSearchProviderChoice | null {
  const value = typeof req.query.provider === 'string' ? req.query.provider : 'all';
  return value === 'all' || available.includes(value as ImageSearchProviderName) ? value as ImageSearchProviderChoice : null;
}

function decodeCursor(value: string, query: string, provider: ImageSearchProviderChoice, available: ImageSearchProviderName[]): CursorPayload | undefined {
  if (value.length > 1800 || !/^[A-Za-z0-9_-]+$/.test(value)) return undefined;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!decoded || typeof decoded !== 'object') return undefined;
    const raw = decoded as Partial<CursorPayload>;
    if (raw.v !== 1 || raw.query !== query.toLowerCase() || raw.provider !== provider ||
        !raw.positions || typeof raw.positions !== 'object') return undefined;
    const positions: Partial<Record<ImageSearchProviderName, number>> = {};
    for (const [name, position] of Object.entries(raw.positions)) {
      if (!available.includes(name as ImageSearchProviderName) ||
          (provider !== 'all' && name !== provider) ||
          !Number.isSafeInteger(position) ||
          (name !== 'openverse' && (Number(position) < 0 || Number(position) > 10000)) ||
          (name === 'openverse' && (Number(position) < 1 || Number(position) > 500))) return undefined;
      positions[name as ImageSearchProviderName] = Number(position);
    }
    if (!Object.keys(positions).length) return undefined;
    return { v: 1, query: raw.query, provider, positions };
  } catch { return undefined; }
}

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function assetKeys(asset: Asset): string[] {
  const keys = ['id:' + asset.id];
  for (const value of [asset.fullUrl, asset.thumbnailUrl]) {
    if (!value) continue;
    try {
      const url = new URL(value);
      url.hash = '';
      for (const key of Array.from(url.searchParams.keys())) {
        if (key.toLocaleLowerCase().startsWith('utm_')) url.searchParams.delete(key);
      }
      keys.push('url:' + url.toString());
    } catch { keys.push('url:' + value); }
  }
  return keys;
}

function readCache(
  cache: Map<string, { expiresAt: number; result: ProviderResult }>,
  key: string,
): ProviderResult | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.result;
}

function writeCache(
  cache: Map<string, { expiresAt: number; result: ProviderResult }>,
  key: string,
  result: ProviderResult,
): void {
  if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
  cache.set(key, { expiresAt: Date.now() + SEARCH_TTL_MS, result });
}
