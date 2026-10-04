import type { Asset, ProgramState } from "../src/shared/types.js";
import { normalizeAsset } from "../src/shared/asset.js";
import { isYouTubeVideoId } from "../src/shared/youtube.js";

export class ProgramStore {
  private state: ProgramState = {
    videoId: null,
    mode: "live",
    activeAsset: null,
    revision: 0,
  };

  constructor(saved?: ProgramState | null) {
    if (saved) {
      if (saved.videoId !== null && !isYouTubeVideoId(saved.videoId)) throw new Error("Invalid saved video.");
      if (!Number.isSafeInteger(saved.revision) || saved.revision < 0) throw new Error("Invalid saved revision.");
      if (saved.mode !== "live" && saved.mode !== "graphic") throw new Error("Invalid saved mode.");
      this.state = { ...saved, activeAsset: saved.mode === "graphic" ? normalizeAsset(saved.activeAsset) : null };
    }
  }

  getState(): ProgramState {
    return structuredClone(this.state);
  }

  setVideo(videoId: string): ProgramState {
    if (!isYouTubeVideoId(videoId)) {
      throw new Error("Invalid YouTube video ID.");
    }

    this.state = {
      ...this.state,
      videoId,
      revision: this.state.revision + 1,
    };
    return this.getState();
  }

  take(asset: Asset): ProgramState {
    const valid = normalizeAsset(asset);
    this.state = {
      ...this.state,
      mode: "graphic",
      activeAsset: valid,
      revision: this.state.revision + 1,
    };
    return this.getState();
  }

  goLive(): ProgramState {
    this.state = {
      ...this.state,
      mode: "live",
      activeAsset: null,
      revision: this.state.revision + 1,
    };
    return this.getState();
  }
}
