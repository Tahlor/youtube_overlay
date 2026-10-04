export type ProgramMode = "live" | "graphic";

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

export interface ProgramState {
  videoId: string | null;
  mode: ProgramMode;
  activeAsset: Asset | null;
  revision: number;
  playback: PlaybackState;
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
  action: "play" | "pause" | "seek" | "skip";
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
  favorites: LibraryAsset[];
  recent: LibraryAsset[];
}
