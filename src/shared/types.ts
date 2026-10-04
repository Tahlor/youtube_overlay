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
