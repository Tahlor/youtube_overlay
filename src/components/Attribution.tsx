import type { Asset } from '../shared/types';
export function Attribution({ asset }: { asset: Asset }) {
  return <p className="attribution">
    {asset.sourceUrl ? <a href={asset.sourceUrl} target="_blank" rel="noreferrer">{asset.source ?? 'Image source'}</a> : asset.source}
    {asset.author && <span> · {asset.author}</span>}
    {asset.license && <span> · {asset.licenseUrl ? <a href={asset.licenseUrl} target="_blank" rel="noreferrer">{asset.license}</a> : asset.license}</span>}
  </p>;
}
