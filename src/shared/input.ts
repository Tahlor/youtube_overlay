import type { CameraSource, InputSource, ProgramAudio } from './types.js';

export const INPUT_SOURCES: readonly InputSource[] = ['youtube', 'phone1', 'phone2', 'phone3', 'phone4', 'director'];
export const CAMERA_SOURCES: readonly CameraSource[] = ['phone1', 'phone2', 'phone3', 'phone4', 'director'];

export function isInputSource(value: unknown): value is InputSource {
  return typeof value === 'string' && INPUT_SOURCES.includes(value as InputSource);
}

export function isCameraSource(value: unknown): value is CameraSource {
  return typeof value === 'string' && CAMERA_SOURCES.includes(value as CameraSource);
}

export function defaultAudio(): ProgramAudio {
  return {
    followSelected: true,
    source: 'youtube',
    levels: Object.fromEntries(INPUT_SOURCES.map(source => [source, { volume: 100, muted: false }])) as ProgramAudio['levels'],
  };
}

export function effectiveAudioSource(source: InputSource, audio: ProgramAudio): InputSource {
  return audio.followSelected ? source : audio.source;
}
