import type { Asset } from '../src/shared/types.js';
import { normalizeAsset } from '../src/shared/asset.js';

export interface ImageProvider { search(query: string): Promise<Asset[]> }

type CommonsPage = { pageid: number; title: string; index?: number; imageinfo?: {
  url: string; thumburl?: string; descriptionurl: string; mime?: string;
  extmetadata?: Record<string, { value: string }>;
}[] };

export class WikimediaProvider implements ImageProvider {
  constructor(private request: typeof fetch = fetch) {}
  async search(query: string): Promise<Asset[]> {
    const params = new URLSearchParams({
      action: 'query', format: 'json', generator: 'search', gsrsearch: `${query} filetype:bitmap`,
      gsrnamespace: '6', gsrlimit: '12', prop: 'imageinfo', iiprop: 'url|mime|extmetadata',
      iiurlwidth: '960', iiextmetadatafilter: 'Artist|LicenseShortName|LicenseUrl',
    });
    const response = await this.request(`https://commons.wikimedia.org/w/api.php?${params}`, {
      signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'YouTubeOverlay/0.2 (https://github.com/Tahlor/youtube_overlay)' },
    });
    if (!response.ok) throw new Error(`Image provider returned HTTP ${response.status}. Try again shortly.`);
    const data = await response.json() as { query?: { pages?: Record<string, CommonsPage> }; error?: unknown };
    if (data.error) throw new Error('Image provider could not complete this search.');
    return Object.values(data.query?.pages ?? {}).sort((a,b) => (a.index ?? 0) - (b.index ?? 0)).flatMap(page => {
      const info = page.imageinfo?.[0];
      if (!info?.thumburl || !/^image\/(jpeg|png|gif|webp)$/.test(info.mime ?? '')) return [];
      if (![info.thumburl, info.url].every(url => { try { return ['upload.wikimedia.org', 'thumb.wikimedia.org'].includes(new URL(url).hostname); } catch { return false; } })) return [];
      const meta = info.extmetadata ?? {};
      try {
        return [normalizeAsset({
          id: `commons:${page.pageid}`, title: plainText(page.title.replace(/^File:/, '')).slice(0,500),
          fullUrl: info.thumburl, thumbnailUrl: info.thumburl, source: 'Wikimedia Commons', sourceUrl: info.descriptionurl,
          author: plainText(meta.Artist?.value ?? 'See source for creator').slice(0,1000) || 'See source for creator',
          license: plainText(meta.LicenseShortName?.value ?? 'See source for license').slice(0,1000) || 'See source for license',
          ...(meta.LicenseUrl?.value?.startsWith('https://') ? { licenseUrl: meta.LicenseUrl.value } : {}),
        })];
      } catch { return []; }
    });
  }
}

export function plainText(value: string): string {
  return value.replace(/<[^>]*>/g, '').replace(/&(?:amp|quot|apos|lt|gt|nbsp);/g, entity => ({
    '&amp;':'&', '&quot;':'"', '&apos;':"'", '&lt;':'<', '&gt;':'>', '&nbsp;':' ',
  }[entity] ?? entity)).trim();
}
