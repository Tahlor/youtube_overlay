import type { PlaybackState } from './types.js';

export const MAX_VIDEO_SECONDS = 31_536_000;
export function isVideoTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_VIDEO_SECONDS;
}

export function playbackPosition(playback: PlaybackState, now: number): number | null {
  if (playback.position === null) return null;
  return Math.min(MAX_VIDEO_SECONDS, playback.position + (playback.status === 'playing' ? Math.max(0, now - playback.updatedAt) / 1000 : 0));
}

export function formatTime(seconds: number): string {
  const time = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(time / 3600);
  const minutes = Math.floor(time / 60) % 60;
  const rest = String(time % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

export function parseTime(value: string): number | null {
  const input = value.trim();
  if (!/^\d+(?::\d{1,2}){0,2}(?:\.\d+)?$/.test(input)) return null;
  const parts = input.split(':').map(Number);
  if (parts.slice(1).some(part => part >= 60)) return null;
  const seconds = parts.reduce((total, part) => total * 60 + part, 0);
  return isVideoTime(seconds) ? seconds : null;
}
