import { useEffect, useState } from 'react';
import type { Asset } from '../shared/types';
export function AssetImage({ asset, thumbnail = false, onReady }: { asset: Asset; thumbnail?: boolean; onReady?: (ready: boolean) => void }) {
  const [failed,setFailed] = useState(false);
  const src = thumbnail ? asset.thumbnailUrl ?? asset.fullUrl : asset.fullUrl;
  useEffect(() => { setFailed(false); }, [src]);
  if (failed) return <div className="image-error" role="status">Image unavailable. Select another graphic or press LIVE.</div>;
  return <img key={src} src={src} alt={asset.title} onLoad={() => onReady?.(true)} onError={() => { setFailed(true); onReady?.(false); }} />;
}
