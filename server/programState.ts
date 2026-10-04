import type { Asset, ProgramState, PlaybackCommand, PlaybackState } from "../src/shared/types.js";
import { isVideoTime, playbackPosition, MAX_VIDEO_SECONDS } from "../src/shared/playback.js";
import { normalizeAsset } from "../src/shared/asset.js";
import { isYouTubeVideoId } from "../src/shared/youtube.js";
import { DEFAULT_PRESENTATION, normalizePresentation } from "../src/shared/presentation.js";

export class ProgramStore {
  private state: ProgramState = {
    videoId: null,
    mode: "live",
    activeAsset: null,
    revision: 0,
    playback: { status: "playing", position: null, updatedAt: 0, revision: 0 },
    presentation: { ...DEFAULT_PRESENTATION },
  };

  constructor(saved?: (Omit<ProgramState, 'playback' | 'presentation'> & { playback?: PlaybackState; presentation?: unknown }) | null) {
    if (saved) {
      if (saved.videoId !== null && !isYouTubeVideoId(saved.videoId)) throw new Error("Invalid saved video.");
      if (!Number.isSafeInteger(saved.revision) || saved.revision < 0) throw new Error("Invalid saved revision.");
      if (saved.mode !== "live" && saved.mode !== "graphic") throw new Error("Invalid saved mode.");
      const playback: PlaybackState = saved.playback ?? { status: "playing", position: null, updatedAt: 0, revision: 0 };
      if (!['playing', 'paused'].includes(playback.status) || (playback.position !== null && !isVideoTime(playback.position)) ||
        !Number.isSafeInteger(playback.updatedAt) || playback.updatedAt < 0 || !Number.isSafeInteger(playback.revision) || playback.revision < 0) {
        throw new Error("Invalid saved playback.");
      }
      // Resume from the saved point after a process restart; downtime is not viewing time.
      this.state = {
        ...saved,
        playback: { ...playback, updatedAt: playback.status === 'playing' && playback.position !== null ? Date.now() : playback.updatedAt },
        presentation: normalizePresentation(saved.presentation),
        activeAsset: saved.mode === "graphic" ? normalizeAsset(saved.activeAsset) : null,
      };
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
      playback: { status: "playing", position: null, updatedAt: Date.now(), revision: this.state.playback.revision + 1 },
      revision: this.state.revision + 1,
    };
    return this.getState();
  }

  controlPlayback(value: PlaybackCommand, observedPosition?: number, duration?: number): ProgramState {
    if (!value || !this.state.videoId || value.videoId !== this.state.videoId) throw new Error("Choose a video before controlling playback.");
    if (value.playbackRevision !== this.state.playback.revision) throw new Error("Playback changed. Try the control again.");
    if (!['play', 'pause', 'seek', 'skip', 'live'].includes(value.action)) throw new Error("Invalid playback action.");
    if (value.position !== undefined && !isVideoTime(value.position)) throw new Error("Invalid playback position.");
    if (value.action === 'seek' && !isVideoTime(value.position)) throw new Error("A valid seek position is required.");
    if (value.action === 'skip' && (typeof value.seconds !== 'number' || !Number.isFinite(value.seconds) || Math.abs(value.seconds) > 3600)) throw new Error("Skip must be between −3600 and 3600 seconds.");
    const now = Date.now();
    const current = observedPosition ?? playbackPosition(this.state.playback, now) ?? value.position;
    if ((value.action === 'pause' || value.action === 'skip') && current === undefined) throw new Error("Wait for the player to load, then try again.");
    let position = value.action === 'seek' ? value.position! : value.action === 'skip' ? current! + value.seconds! : value.action === 'live' ? (value.position ?? (duration && duration > 0 ? duration : current) ?? null) : current ?? null;
    if (position !== null) position = Math.max(0, Math.min(duration && duration > 0 ? duration : MAX_VIDEO_SECONDS, position));
    this.state = { ...this.state, revision: this.state.revision + 1, playback: {
      status: value.action === 'pause' ? 'paused' : (value.action === 'play' || value.action === 'live') ? 'playing' : this.state.playback.status,
      position, updatedAt: now, revision: this.state.playback.revision + 1,
    } };
    return this.getState();
  }

  recordPosition(position: number): ProgramState {
    if (!isVideoTime(position)) throw new Error("Invalid playback position.");
    this.state = { ...this.state, playback: { ...this.state.playback, position, updatedAt: Date.now() } };
    return this.getState();
  }

  take(asset: Asset, presentation?: unknown): ProgramState {
    const valid = normalizeAsset(asset);
    const settings = presentation === undefined ? this.state.presentation : normalizePresentation(presentation);
    this.state = {
      ...this.state,
      mode: "graphic",
      activeAsset: valid,
      presentation: settings,
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
