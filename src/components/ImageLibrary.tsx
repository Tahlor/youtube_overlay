import { useCallback, useEffect, useRef, useState } from 'react';
import type { Asset, Library } from '../shared/types';
import { appPath } from '../basePath';
import { socket } from '../socket';
import { AssetImage } from './AssetImage';
import { Attribution } from './Attribution';
import './search.css';

export const TEST_ASSET: Asset = { id: 'm0-test-graphic', title: 'General Conference Director test graphic', fullUrl: appPath('test-graphic.svg'), thumbnailUrl: appPath('test-graphic.svg'), source: 'Built in' };

type SearchProvider = 'all' | 'lds' | 'commons' | 'openverse';
type ProviderName = Exclude<SearchProvider, 'all'>;
type LibraryTab = 'Search' | 'Uploads' | 'Favorites' | 'Recent';
const SOURCE_LABELS: Record<ProviderName, string> = { lds: 'Church Media', commons: 'Wikimedia', openverse: 'Openverse' };
const DEFAULT_SOURCES: ProviderName[] = ['commons', 'openverse'];
const UPLOAD_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
type ProviderProgress = { state: 'loading' | 'done' | 'error'; count: number; error?: string };
type SearchContext = { query: string; provider: SearchProvider };
type SearchEvent =
  | { type: 'start'; query: string; providers: ProviderName[] }
  | { type: 'provider'; provider: ProviderName; assets: Asset[]; nextCursor: string | null; error?: string }
  | { type: 'done'; cursor: string | null; hasMore: boolean; providers: { provider: ProviderName; status: 'ok' | 'error'; nextCursor: string | null }[] };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(appPath(url), { ...init, signal: init?.signal ?? AbortSignal.timeout(15000) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Request failed.');
  return data as T;
}

export function ImageLibrary({ preview, select }: { preview: Asset | null; select: (asset: Asset) => void }) {
  const [query, setQuery] = useState('');
  const [sources, setSources] = useState<ProviderName[]>(DEFAULT_SOURCES);
  const [provider, setProvider] = useState<SearchProvider>('all');
  const [results, setResults] = useState<Asset[]>([]);
  const [tab, setTab] = useState<LibraryTab>('Search');
  const [library, setLibrary] = useState<Library>({ uploads: [], favorites: [], recent: [] });
  const [busy, setBusy] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [directError, setDirectError] = useState('');
  const [libraryError, setLibraryError] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploadNotice, setUploadNotice] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [progress, setProgress] = useState<Partial<Record<ProviderName, ProviderProgress>>>({});
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [searchContext, setSearchContext] = useState<SearchContext | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const searchAbort = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const resultRef = useRef<Asset[]>([]);

  const refresh = useCallback(() => {
    request<Library>('api/library').then(data => {
      setLibrary({ uploads: data.uploads ?? [], favorites: data.favorites ?? [], recent: data.recent ?? [] });
      setLibraryError('');
    }).catch(error => setLibraryError(error.message));
  }, []);

  useEffect(() => {
    request<{ sources: ProviderName[] }>('api/images/sources')
      .then(data => {
        const known = data.sources.filter(name => name in SOURCE_LABELS);
        if (known.length) setSources(known);
      })
      .catch(() => { /* keep the default sources */ });
    refresh();
    socket.on('library:changed', refresh);
    socket.on('connect', refresh);
    const onPaste = (event: ClipboardEvent) => {
      const image = Array.from(event.clipboardData?.files ?? []).find(file => UPLOAD_TYPES.has(file.type));
      if (!image) return;
      event.preventDefault();
      void uploadImage(image, true);
    };
    window.addEventListener('paste', onPaste);
    return () => {
      generation.current++;
      socket.off('library:changed', refresh);
      socket.off('connect', refresh);
      window.removeEventListener('paste', onPaste);
      searchAbort.current?.abort();
    };
  }, [refresh]);

  async function uploadImage(file: File, pasted = false) {
    if (!UPLOAD_TYPES.has(file.type)) {
      setUploadError('Choose a PNG, JPEG, or WebP image.');
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      setUploadError('Image is too large. Maximum size is 12 MB.');
      return;
    }
    setUploading(true);
    setUploadError('');
    setUploadNotice(pasted ? 'Pasting image…' : 'Uploading image…');
    try {
      const fallbackName = pasted && !file.name ? `Pasted image.${file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'}` : file.name;
      const response = await fetch(appPath('uploads'), {
        method: 'POST',
        headers: {
          'Content-Type': file.type,
          'X-Upload-Name': encodeURIComponent(fallbackName || 'Uploaded image'),
        },
        body: file,
        signal: AbortSignal.timeout(20000),
      });
      const data = await response.json() as { asset?: Asset; error?: string };
      if (!response.ok || !data.asset) throw new Error(data.error ?? 'Could not upload this image.');
      setUploadNotice(pasted ? 'Pasted image ready' : 'Uploaded image ready');
      setTab('Uploads');
      refresh();
      select(data.asset);
    } catch (error) {
      setUploadNotice('');
      setUploadError(error instanceof Error ? error.message : 'Could not upload this image.');
    } finally {
      setUploading(false);
    }
  }

  async function runSearch(loadNext = false) {
    const targetQuery = loadNext ? searchContext?.query ?? '' : query.trim();
    const targetProvider = loadNext ? searchContext?.provider ?? provider : provider;
    if (targetQuery.length < 2 || (loadNext && !nextCursor)) return;
    searchAbort.current?.abort();
    const controller = new AbortController();
    searchAbort.current = controller;
    const requestId = ++generation.current;
    const cursor = loadNext ? nextCursor : null;
    setBusy(true);
    setLoadingMore(loadNext);
    setSearchError('');
    setDirectError('');
    setTab('Search');
    if (!loadNext) {
      resultRef.current = [];
      setResults([]);
      setSearched(false);
      setSearchContext({ query: targetQuery, provider: targetProvider });
      setNextCursor(null);
      setHasMore(false);
    }
    const initialProgress: Partial<Record<ProviderName, ProviderProgress>> = {};
    (targetProvider === 'all' ? sources : [targetProvider]).forEach(name => {
      initialProgress[name as ProviderName] = { state: 'loading', count: 0 };
    });
    setProgress(initialProgress);

    let receivedDone = false;
    try {
      const params = new URLSearchParams({ q: targetQuery, provider: targetProvider });
      if (cursor) params.set('cursor', cursor);
      const response = await fetch(appPath('api/images/search/stream?' + params), {
        headers: { Accept: 'application/x-ndjson' },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25000)]),
      });
      if (!response.ok) {
        let message = 'Image search is unavailable. Try again shortly.';
        try { message = (await response.json()).error ?? message; } catch { /* use the default */ }
        throw new Error(message);
      }
      if (!response.body) throw new Error('This browser cannot stream search results.');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = '';
      const applyLine = (line: string) => {
        if (!line.trim() || requestId !== generation.current || controller.signal.aborted) return;
        let event: SearchEvent;
        try { event = JSON.parse(line) as SearchEvent; } catch { return; }
        if (event.type === 'start') {
          const waiting: Partial<Record<ProviderName, ProviderProgress>> = {};
          event.providers.forEach(name => { waiting[name] = { state: 'loading', count: 0 }; });
          setProgress(waiting);
        } else if (event.type === 'provider') {
          const merged = mergeAssets(resultRef.current, event.assets);
          resultRef.current = merged;
          setResults(merged);
          setProgress(current => ({
            ...current,
            [event.provider]: {
              state: event.error ? 'error' : 'done',
              count: event.assets.length,
              ...(event.error ? { error: event.error } : {}),
            },
          }));
        } else if (event.type === 'done') {
          receivedDone = true;
          setNextCursor(event.cursor);
          setHasMore(event.hasMore);
          setSearched(true);
          setProgress(current => {
            const updated = { ...current };
            event.providers.forEach(source => {
              updated[source.provider] = {
                state: source.status === 'error' ? 'error' : 'done',
                count: updated[source.provider]?.count ?? 0,
                ...(updated[source.provider]?.error ? { error: updated[source.provider]?.error } : {}),
              };
            });
            return updated;
          });
        }
      };
      while (requestId === generation.current && !controller.signal.aborted) {
        const chunk = await reader.read();
        pending += decoder.decode(chunk.value, { stream: !chunk.done });
        const lines = pending.split('\n');
        pending = lines.pop() ?? '';
        lines.forEach(applyLine);
        if (chunk.done) break;
      }
      if (pending.trim()) applyLine(pending);
      if (!controller.signal.aborted && requestId === generation.current && !receivedDone) {
        throw new Error('Image search ended before all sources returned.');
      }
    } catch (error) {
      if (!controller.signal.aborted && requestId === generation.current) {
        setSearchError(error instanceof Error ? error.message : 'Image search unavailable.');
      }
    } finally {
      if (requestId === generation.current) {
        setBusy(false);
        setLoadingMore(false);
      }
    }
  }

  function cancelSearch() {
    searchAbort.current?.abort();
    generation.current++;
    setBusy(false);
    setLoadingMore(false);
    setProgress({});
  }

  function discardActiveSearch() {
    cancelSearch();
    resultRef.current = [];
    setResults([]);
    setSearchContext(null);
    setNextCursor(null);
    setHasMore(false);
    setSearched(false);
    setSearchError('');
  }

  function importDirectUrl() {
    const trimmed = imageUrl.trim();
    try {
      const url = new URL(trimmed);
      if (url.protocol !== 'https:' || url.username || url.password || url.href.length > 4096) {
        throw new Error('Enter an HTTPS image URL.');
      }
      const asset: Asset = {
        id: stableUrlId(url.href),
        title: (url.pathname.split('/').filter(Boolean).pop() || url.hostname).slice(0, 500),
        fullUrl: url.href,
        thumbnailUrl: url.href,
        source: 'Direct URL',
        sourceUrl: url.href,
      };
      select(asset);
      setImageUrl('');
      setDirectError('');
    } catch (error) {
      setDirectError(error instanceof Error && error.message === 'Enter an HTTPS image URL.'
        ? error.message : 'Enter a valid HTTPS image URL.');
    }
  }

  const favorite = !!preview && library.favorites.some(row => row.asset.id === preview.id);
  async function toggleFavorite() {
    if (!preview) return;
    setSaving(true);
    try {
      await request('api/library/favorite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ asset: preview, favorite: !favorite }) });
      refresh();
    } catch (error) { setLibraryError((error as Error).message); }
    finally { setSaving(false); }
  }

  const assets = tab === 'Search' ? results
    : tab === 'Uploads' ? library.uploads.map(row => row.asset)
      : library[tab === 'Favorites' ? 'favorites' : 'recent'].map(row => row.asset);
  const canLoadMore = !!nextCursor && hasMore && !!searchContext &&
    query.trim() === searchContext.query && provider === searchContext.provider;
  const contextIsCurrent = !!searchContext && query.trim() === searchContext.query && provider === searchContext.provider;
  const googleImagesUrl = query.trim().length >= 2
    ? 'https://www.google.com/search?tbm=isch&q=' + encodeURIComponent(query.trim())
    : '';
  const sourceSummary = Object.entries(progress).map(([name, state]) => {
    const label = SOURCE_LABELS[name as ProviderName] ?? name;
    if (state?.state === 'loading') return label + ' …';
    if (state?.state === 'error') return label + ' unavailable';
    return label + ' ' + (state?.count ?? 0);
  }).join(' · ');
  const sourceOptions: { value: SearchProvider; label: string }[] = [
    ...(sources.length > 1 ? [{ value: 'all' as const, label: 'All' }] : []),
    ...sources.map(name => ({ value: name as SearchProvider, label: SOURCE_LABELS[name] })),
  ];

  return <section className="image-library" aria-labelledby="image-library-title">
    <div className="image-library__top">
      <h2 id="image-library-title">Images</h2>
      <div className="library-tabs" role="tablist" aria-label="Image library">
        {(['Search', 'Uploads', 'Favorites', 'Recent'] as const).map(name => <button key={name} role="tab" aria-selected={tab === name} onClick={() => setTab(name)}>{name}</button>)}
      </div>
    </div>

    <div className="image-library__upload-actions">
      <input ref={fileInput} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp" onChange={event => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (file) void uploadImage(file);
      }} />
      <button type="button" className="secondary-button" disabled={uploading} onClick={() => fileInput.current?.click()}>
        {uploading ? 'Adding image…' : 'Upload image'}
      </button>
      <span className="muted-note">or copy an image and paste it anywhere here</span>
      {uploadNotice && <span className="upload-notice" role="status">{uploadNotice}</span>}
    </div>
    {uploadError && <p className="error-message" role="alert">{uploadError}</p>}

    <form className="image-library__search" onSubmit={event => { event.preventDefault(); void runSearch(false); }}>
      <label className="visually-hidden" htmlFor="image-query">Search images</label>
      <div className="image-library__search-row">
        <input id="image-query" type="search" value={query} maxLength={120} onChange={event => {
          const next = event.target.value;
          setQuery(next);
          if (busy && next.trim() !== searchContext?.query) discardActiveSearch();
        }} placeholder="Search images — Christ, temples, pioneers…" />
        <button disabled={query.trim().length < 2}>{busy ? 'Search again' : 'Search'}</button>
      </div>
      <div className="image-library__sources" role="radiogroup" aria-label="Image sources">
        {sourceOptions.map(option => <button type="button" key={option.value} role="radio" aria-checked={provider === option.value}
          className={'source-chip' + (provider === option.value ? ' source-chip--active' : '')}
          onClick={() => {
            setProvider(option.value);
            if (busy && option.value !== searchContext?.provider) discardActiveSearch();
          }}>{option.label}</button>)}
      </div>
    </form>

    {searchError && <p className="error-message" role="alert">{searchError}</p>}
    {libraryError && <p className="error-message" role="alert">{libraryError} <button onClick={refresh}>Retry saved assets</button></p>}

    <div className="image-library__result-status" aria-live="polite">
      {busy ? <span>{loadingMore ? 'Loading more…' : 'Searching…'} {sourceSummary}</span>
        : sourceSummary && contextIsCurrent && tab === 'Search' ? <span>{sourceSummary}</span>
          : searchContext && !contextIsCurrent && results.length > 0 && tab === 'Search'
            ? <span>Showing results for “{searchContext.query}”. Search again to use these settings.</span>
            : <span />}
      <span className="image-library__status-actions">
        {busy && <button type="button" className="image-library__cancel" onClick={cancelSearch}>Cancel</button>}
        {preview && <button className="favorite-button" disabled={saving} onClick={() => void toggleFavorite()} aria-label={favorite ? 'Unfavorite Preview' : 'Favorite Preview'}>{favorite ? '★ Unfavorite preview' : '☆ Favorite preview'}</button>}
      </span>
    </div>

    <div className="asset-grid">
      {assets.map(asset => <article className="image-library__card" key={asset.id}>
        <button className="asset-card" onClick={() => select(asset)} aria-label={'Preview ' + asset.title}>
          <AssetImage asset={asset} thumbnail />
          <span>{asset.title}</span>
        </button>
        <details className="image-library__attribution">
          <summary>Source and license</summary>
          <Attribution asset={asset} />
        </details>
      </article>)}
    </div>
    {canLoadMore && tab === 'Search' && <button className="secondary-button image-library__more" disabled={busy} onClick={() => void runSearch(true)}>Load more images</button>}
    {!busy && !assets.length && <p className="muted-note">{tab === 'Search' ? searched ? 'No images found. Try another search.' : 'Search and preview an image, then TAKE it to air.' : `No ${tab.toLowerCase()} yet.`}</p>}
    <form className="image-library__import" onSubmit={event => { event.preventDefault(); importDirectUrl(); }}>
      <label className="visually-hidden" htmlFor="image-url">Use an image URL</label>
      <div className="image-library__import-row">
        <input id="image-url" type="url" inputMode="url" value={imageUrl} maxLength={4096} onChange={event => setImageUrl(event.target.value)} placeholder="Or paste an image URL (https://…)" />
        <button className="secondary-button" disabled={!imageUrl.trim()}>Preview URL</button>
      </div>
      {directError && <p className="error-message" role="alert">{directError}</p>}
    </form>
    <div className="image-library__footer">
      {googleImagesUrl && <a href={googleImagesUrl} target="_blank" rel="noreferrer">Open Google Images ↗</a>}
      <button className="image-library__test" onClick={() => select(TEST_ASSET)}>Load built-in test graphic</button>
    </div>
  </section>;
}

function mergeAssets(existing: Asset[], incoming: Asset[]): Asset[] {
  const output = [...existing];
  const seen = new Set<string>();
  output.forEach(asset => assetKeys(asset).forEach(key => seen.add(key)));
  incoming.forEach(asset => {
    const keys = assetKeys(asset);
    if (keys.some(key => seen.has(key))) return;
    keys.forEach(key => seen.add(key));
    output.push(asset);
  });
  return output;
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

function stableUrlId(value: string): string {
  let left = 2166136261;
  let right = 2246822519;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    left = Math.imul(left ^ code, 16777619) >>> 0;
    right = Math.imul(right ^ (code + 0x9e), 3266489917) >>> 0;
  }
  return 'direct:' + left.toString(16).padStart(8, '0') + right.toString(16).padStart(8, '0');
}
