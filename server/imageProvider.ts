import type { Asset } from '../src/shared/types.js';
import { normalizeAsset, safeAssetUrl } from '../src/shared/asset.js';

export interface ImageSearchPage {
  assets: Asset[];
  nextPage: number | null;
}

export interface ImageProvider {
  search(query: string): Promise<Asset[]>;
  searchPage(query: string, page: number, signal?: AbortSignal): Promise<ImageSearchPage>;
}

type CommonsPage = { pageid: number; title: string; index?: number; imageinfo?: {
  url: string; thumburl?: string; descriptionurl: string; mime?: string;
  extmetadata?: Record<string, { value: string }>;
}[] };

type CommonsResponse = {
  query?: { pages?: Record<string, CommonsPage> };
  continue?: { gsroffset?: number };
  error?: unknown;
};

const REQUEST_TIMEOUT_MS = 10000;
const USER_AGENT = 'YouTubeOverlay/0.3 (https://github.com/Tahlor/youtube_overlay)';

export class WikimediaProvider implements ImageProvider {
  constructor(private request: typeof fetch = fetch) {}

  async search(query: string): Promise<Asset[]> {
    return (await this.searchPage(query, 0)).assets;
  }

  async searchPage(query: string, page: number, signal?: AbortSignal): Promise<ImageSearchPage> {
    const offset = Number.isSafeInteger(page) && page >= 0 ? page : 0;
    const params = new URLSearchParams({
      action: 'query', format: 'json', generator: 'search', gsrsearch: query + ' filetype:bitmap',
      gsrnamespace: '6', gsrlimit: '12', prop: 'imageinfo', iiprop: 'url|mime|extmetadata',
      iiurlwidth: '480', iiextmetadatafilter: 'Artist|LicenseShortName|LicenseUrl',
    });
    if (offset) params.set('gsroffset', String(offset));
    const response = await this.request('https://commons.wikimedia.org/w/api.php?' + params, {
      signal: combinedSignal(signal),
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!response.ok) throw new Error('Wikimedia Commons returned HTTP ' + response.status + '.');
    const data = await response.json() as CommonsResponse;
    if (data.error) throw new Error('Wikimedia Commons could not complete this search.');
    const assets = Object.values(data.query?.pages ?? {})
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .flatMap(pageData => {
        const info = pageData.imageinfo?.[0];
        if (!info?.url || !info.thumburl || !/^image\/(jpeg|png|gif|webp)$/.test(info.mime ?? '')) return [];
        if (!isAllowedCommonsImageUrl(info.url) || !isAllowedCommonsImageUrl(info.thumburl)) return [];
        if (!isCommonsPageUrl(info.descriptionurl)) return [];
        const meta = info.extmetadata ?? {};
        const licenseUrl = meta.LicenseUrl?.value;
        try {
          return [normalizeAsset({
            id: 'commons:' + pageData.pageid,
            title: plainText(pageData.title.replace(/^File:/, '')).slice(0, 500) || 'Untitled image',
            fullUrl: info.url,
            thumbnailUrl: info.thumburl,
            source: 'Wikimedia Commons',
            sourceUrl: info.descriptionurl,
            author: plainText(meta.Artist?.value ?? 'See source for creator').slice(0, 1000) || 'See source for creator',
            license: plainText(meta.LicenseShortName?.value ?? 'See source for license').slice(0, 1000) || 'See source for license',
            ...(isHttpsUrl(licenseUrl) ? { licenseUrl } : {}),
          })];
        } catch { return []; }
      });
    const next = data.continue?.gsroffset;
    return { assets, nextPage: Number.isSafeInteger(next) && next! > offset ? next! : null };
  }
}

type OpenverseImage = {
  id?: string;
  title?: string | null;
  url?: string | null;
  thumbnail?: string | null;
  foreign_landing_url?: string | null;
  detail_url?: string | null;
  creator?: string | null;
  license?: string | null;
  license_version?: string | null;
  license_url?: string | null;
  provider?: string | null;
};

type OpenverseResponse = {
  page?: number;
  page_count?: number;
  results?: OpenverseImage[];
};

export class OpenverseProvider implements ImageProvider {
  constructor(private request: typeof fetch = fetch) {}

  async search(query: string): Promise<Asset[]> {
    return (await this.searchPage(query, 1)).assets;
  }

  async searchPage(query: string, page: number, signal?: AbortSignal): Promise<ImageSearchPage> {
    const currentPage = Number.isSafeInteger(page) && page >= 1 && page <= 500 ? page : 1;
    const params = new URLSearchParams({
      q: query,
      page: String(currentPage),
      page_size: '20',
      mature: 'false',
    });
    const response = await this.request('https://api.openverse.org/v1/images/?' + params, {
      signal: combinedSignal(signal),
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    });
    if (!response.ok) throw new Error('Openverse returned HTTP ' + response.status + '.');
    const data = await response.json() as OpenverseResponse;
    const assets = (data.results ?? []).flatMap((image, index) => {
      if (!image.id || !isHttpsUrl(image.url) || !isHttpsUrl(image.thumbnail)) return [];
      const landing = isHttpsUrl(image.foreign_landing_url) ? image.foreign_landing_url
        : isHttpsUrl(image.detail_url) ? image.detail_url : undefined;
      const licenseCode = plainText(image.license ?? '').toUpperCase().replace(/-/g, ' ');
      const licenseVersion = plainText(image.license_version ?? '');
      const license = [licenseCode, licenseVersion].filter(Boolean).join(' ');
      try {
        return [normalizeAsset({
          id: 'openverse:' + image.id,
          title: plainText(image.title ?? '').slice(0, 500) || 'Openverse image ' + (index + 1),
          fullUrl: image.url,
          thumbnailUrl: image.thumbnail,
          source: image.provider ? 'Openverse · ' + plainText(image.provider).slice(0, 120) : 'Openverse',
          ...(landing ? { sourceUrl: landing } : {}),
          ...(image.creator ? { author: plainText(image.creator).slice(0, 1000) } : {}),
          ...(license ? { license } : {}),
          ...(isHttpsUrl(image.license_url) ? { licenseUrl: image.license_url } : {}),
        })];
      } catch { return []; }
    });
    const reportedPageCount = data.page_count;
    return {
      assets,
      nextPage: Number.isSafeInteger(reportedPageCount) && currentPage < Math.min(reportedPageCount!, 500)
        ? currentPage + 1 : null,
    };
  }
}

function combinedSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function isAllowedCommonsImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password &&
      ['upload.wikimedia.org', 'thumb.wikimedia.org'].includes(url.hostname);
  } catch { return false; }
}

function isCommonsPageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && url.hostname === 'commons.wikimedia.org';
  } catch { return false; }
}

function isHttpsUrl(value: unknown): value is string {
  if (!safeAssetUrl(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:';
  } catch { return false; }
}

export function plainText(value: string): string {
  return value.replace(/<[^>]*>/g, '').replace(/&(?:amp|quot|apos|lt|gt|nbsp);/g, entity => ({
    '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' ',
  }[entity] ?? entity)).trim();
}
