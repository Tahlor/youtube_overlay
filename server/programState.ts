import type { Asset, ProgramState } from "../src/shared/types.js";
import { isYouTubeVideoId } from "../src/shared/youtube.js";

export class ProgramStore {
  private state: ProgramState = {
    videoId: null,
    mode: "live",
    activeAsset: null,
    revision: 0,
  };

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
    validateAsset(asset);
    this.state = {
      ...this.state,
      mode: "graphic",
      activeAsset: structuredClone(asset),
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

function validateAsset(asset: Asset): void {
  if (!asset || typeof asset !== "object") {
    throw new Error("Invalid asset.");
  }
  if (!nonEmpty(asset.id) || !nonEmpty(asset.title) || !nonEmpty(asset.fullUrl)) {
    throw new Error("Asset id, title, and fullUrl are required.");
  }
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
