import { useCallback, useEffect, useRef, useState } from 'react';
import type { Asset, Library } from '../shared/types';
import { appPath } from '../basePath';
import { socket } from '../socket';
import { AssetImage } from './AssetImage';
import { Attribution } from './Attribution';

export const TEST_ASSET: Asset = { id: 'm0-test-graphic', title: 'General Conference Director test graphic', fullUrl: appPath('test-graphic.svg'), thumbnailUrl: appPath('test-graphic.svg'), source: 'Built in' };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(appPath(url), { ...init, signal: init?.signal ?? AbortSignal.timeout(15000) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Request failed.');
  return data as T;
}
export function ImageLibrary({ preview, select }: { preview: Asset | null; select: (asset: Asset) => void }) {
  const [query,setQuery] = useState('');
  const [results,setResults] = useState<Asset[]>([]);
  const [tab,setTab] = useState<'Search'|'Favorites'|'Recent'>('Search');
  const [library,setLibrary] = useState<Library>({ favorites: [], recent: [] });
  const [busy,setBusy] = useState(false);
  const [searched,setSearched] = useState(false);
  const [searchError,setSearchError] = useState('');
  const [libraryError,setLibraryError] = useState('');
  const [saving,setSaving] = useState(false);
  const searchAbort = useRef<AbortController | null>(null);
  const refresh = useCallback(() => {
    request<Library>('api/library').then(data => { setLibrary(data); setLibraryError(''); }).catch(error => setLibraryError(error.message));
  },[]);
  useEffect(() => {
    refresh(); socket.on('library:changed',refresh); socket.on('connect',refresh);
    return () => { socket.off('library:changed',refresh); socket.off('connect',refresh); searchAbort.current?.abort(); };
  },[refresh]);
  async function search() {
    searchAbort.current?.abort();
    const controller = new AbortController(); searchAbort.current = controller;
    setBusy(true); setSearchError(''); setTab('Search');
    try {
      const data = await request<{assets:Asset[]}>(`api/images/search?q=${encodeURIComponent(query.trim())}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) });
      if (!controller.signal.aborted) { setResults(data.assets); setSearched(true); }
    } catch (error) {
      if (!controller.signal.aborted) setSearchError(error instanceof Error ? error.message : 'Image search unavailable.');
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }
  const favorite = !!preview && library.favorites.some(row => row.asset.id === preview.id);
  async function toggleFavorite() {
    if (!preview) return;
    setSaving(true);
    try {
      await request('api/library/favorite', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({asset:preview,favorite:!favorite}) });
      refresh();
    } catch (error) { setLibraryError((error as Error).message); }
    finally { setSaving(false); }
  }
  const assets = tab === 'Search' ? results : library[tab === 'Favorites' ? 'favorites' : 'recent'].map(row => row.asset);
  return <>
    <div className="panel-heading"><h2>Image library</h2></div>
    <form onSubmit={event => { event.preventDefault(); void search(); }}>
      <label htmlFor="image-query">Search Wikimedia Commons</label>
      <div className="input-row"><input id="image-query" value={query} maxLength={120} onChange={event => setQuery(event.target.value)} placeholder="Temples, family, mountains…" /><button disabled={busy || query.trim().length < 2}>{busy ? 'Searching…' : 'Search'}</button></div>
    </form>
    <div className="library-tabs" role="tablist" aria-label="Image library">
      {(['Search','Favorites','Recent'] as const).map(name => <button key={name} role="tab" aria-selected={tab===name} onClick={() => setTab(name)}>{name}</button>)}
    </div>
    {searchError && <p className="error-message" role="alert">{searchError}</p>}
    {libraryError && <p className="error-message" role="alert">{libraryError} <button onClick={refresh}>Retry saved assets</button></p>}
    {preview && <button className="favorite-button" disabled={saving} onClick={() => void toggleFavorite()}>{favorite ? 'Unfavorite Preview' : 'Favorite Preview'}</button>}
    <div className="asset-grid">
      {assets.map(asset => <article key={asset.id}><button className="asset-card" onClick={() => select(asset)} aria-label={`Preview ${asset.title}`}><AssetImage asset={asset} thumbnail /><span>{asset.title}</span></button><Attribution asset={asset}/></article>)}
    </div>
    {!busy && !assets.length && <p className="muted-note">{tab === 'Search' ? searched ? 'No images found. Try another search.' : 'Search, select a graphic, then press TAKE.' : `No ${tab.toLowerCase()} yet.`}</p>}
    <button className="secondary-button" onClick={() => select(TEST_ASSET)}>Load built-in test graphic</button>
  </>;
}
