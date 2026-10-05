import type { Asset, PresentationSettings } from './types.js';

export const DEFAULT_PRESENTATION: PresentationSettings = {
  layout: 'image',
  corner: 'bottom-right',
  size: 'medium',
  transition: 'fade',
  fit: 'contain',
  motion: 'auto',
};

export function normalizePresentation(value: unknown): PresentationSettings {
  if (value === undefined || value === null) return { ...DEFAULT_PRESENTATION };
  if (typeof value !== 'object') throw new Error('Invalid presentation settings.');
  const settings = value as Partial<PresentationSettings>;
  if (!['shoulder', 'pip', 'image'].includes(settings.layout as string) ||
      !['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(settings.corner as string) ||
      !['small', 'medium', 'large'].includes(settings.size as string) ||
      !['cut', 'fade', 'slide'].includes(settings.transition as string) ||
      !['contain', 'cover'].includes(settings.fit as string) ||
      (settings.motion !== undefined && !['auto', 'still'].includes(settings.motion))) {
    throw new Error('Invalid presentation settings.');
  }
  return {
    layout: settings.layout as PresentationSettings['layout'],
    corner: settings.corner as PresentationSettings['corner'],
    size: settings.size as PresentationSettings['size'],
    transition: settings.transition as PresentationSettings['transition'],
    fit: settings.fit as PresentationSettings['fit'],
    // Existing saved Programs predate motion. Migrate them to the new default.
    motion: settings.motion ?? 'auto',
  };
}

/** Stable low-cost motion variant shared by Preview and Program. */
export function imageMotionVariant(asset: Asset): 0 | 1 | 2 | 3 {
  let hash = 2166136261;
  const key = `${asset.id}|${asset.fullUrl}`;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (Math.abs(hash) % 4) as 0 | 1 | 2 | 3;
}
