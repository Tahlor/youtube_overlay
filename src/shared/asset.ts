import type { Asset } from './types.js';

export function safeAssetUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 4096 || /[\\\x00-\x20]/.test(value)) return false;
  if (value.startsWith('/') && !value.startsWith('//')) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch { return false; }
}

export function normalizeAsset(value: unknown): Asset {
  if (!value || typeof value !== 'object') throw new Error('Invalid asset.');
  const asset = value as Record<string, unknown>;
  if (!text(asset.id, 200) || !text(asset.title, 500) || !text(asset.fullUrl, 4096)) {
    throw new Error('Asset id, title, and fullUrl are required.');
  }
  if (!safeAssetUrl(asset.fullUrl)) throw new Error('Asset URL must use HTTPS or an app path.');
  const result: Asset = { id: asset.id as string, title: asset.title as string, fullUrl: asset.fullUrl as string };
  for (const key of ['thumbnailUrl', 'sourceUrl', 'licenseUrl'] as const) {
    if (asset[key] !== undefined) {
      if (!safeAssetUrl(asset[key])) throw new Error(`Invalid asset ${key}.`);
      result[key] = asset[key] as string;
    }
  }
  for (const key of ['source', 'author', 'license'] as const) {
    if (asset[key] !== undefined) {
      if (!text(asset[key], 1000)) throw new Error(`Invalid asset ${key}.`);
      result[key] = asset[key] as string;
    }
  }
  return result;
}

function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}
