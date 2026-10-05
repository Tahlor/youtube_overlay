export type ProgramMode = "live" | "graphic";
export type InputSource = 'youtube' | 'phone1' | 'phone2' | 'phone3' | 'phone4' | 'director';
export type CameraSource = Exclude<InputSource, 'youtube'>;
export type ImageMotion = 'auto' | 'still';

export interface InputAudioLevel { volume: number; muted: boolean }
export interface ProgramAudio {
  followSelected: boolean;
  source: InputSource;
  levels: Record<InputSource, InputAudioLevel>;
}

export interface PresentationSettings {
  layout: 'shoulder' | 'pip' | 'image';
  corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  size: 'small' | 'medium' | 'large';
  transition: 'cut' | 'fade' | 'slide';
  fit: 'contain' | 'cover';
  // Optional during protocol migration: legacy clients omit it; renderers treat
  // omission as auto motion. New Director state always supplies a value.
  motion?: ImageMotion;
}

export interface Asset {
  id: string;
  title: string;
  fullUrl: string;
  thumbnailUrl?: string;
  source?: string;
  sourceUrl?: string;
  author?: string;
  license?: string;
  licenseUrl?: string;
}

/**
 * Canonical visual scene for the first switcher slice. Legacy `mode`,
 * `activeAsset`, and `presentation` remain on ProgramState during migration,
 * but new rendering should prefer this scene field.
 */
export type ProgramScene =
  | { kind: 'main' }
  | { kind: 'image'; asset: Asset; presentation: PresentationSettings };

export interface ProgramState {
  videoId: string | null;
  source: InputSource;
  audio: ProgramAudio;
  scene: ProgramScene;
  mode: ProgramMode;
  activeAsset: Asset | null;
  revision: number;
  playback: PlaybackState;
  presentation: PresentationSettings;
}

export interface PlaybackState {
  status: "playing" | "paused";
  // null lets YouTube choose the initial position (including a livestream's live edge).
  position: number | null;
  updatedAt: number;
  revision: number;
}

export interface PlaybackCommand {
  videoId: string;
  playbackRevision: number;
  action: "play" | "pause" | "seek" | "skip" | "live";
  position?: number;
  seconds?: number;
}

export interface PlaybackSample {
  videoId: string;
  playbackRevision: number;
  currentTime: number;
  duration: number;
  playerState: number;
  status: string;
}

export interface OutputPlayback extends PlaybackSample {
  receivedAt: number;
}

export interface CommandAck {
  ok: boolean;
  error?: string;
}

export interface LibraryAsset {
  asset: Asset;
  favorite: boolean;
  useCount: number;
  lastUsed: string | null;
}

export interface Library {
  uploads: LibraryAsset[];
  favorites: LibraryAsset[];
  recent: LibraryAsset[];
}
