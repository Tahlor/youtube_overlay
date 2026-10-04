import type { PresentationSettings } from './types.js';
export const DEFAULT_PRESENTATION: PresentationSettings = { layout: 'pip', corner: 'bottom-right', size: 'medium', transition: 'fade', fit: 'contain' };
export function normalizePresentation(value: unknown): PresentationSettings {
  if (value === undefined || value === null) return { ...DEFAULT_PRESENTATION };
  if (typeof value !== 'object') throw new Error('Invalid presentation settings.');
  const settings = value as PresentationSettings;
  if (!['shoulder', 'pip', 'image'].includes(settings.layout) || !['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(settings.corner) ||
      !['small', 'medium', 'large'].includes(settings.size) || !['cut', 'fade', 'slide'].includes(settings.transition) || !['contain', 'cover'].includes(settings.fit)) throw new Error('Invalid presentation settings.');
  return { layout: settings.layout, corner: settings.corner, size: settings.size, transition: settings.transition, fit: settings.fit };
}
