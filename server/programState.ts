import type { Asset, CameraSource, InputSource, ProgramAudio, ProgramState, PlaybackCommand, PlaybackState } from "../src/shared/types.js";
import { isVideoTime, playbackPosition, MAX_VIDEO_SECONDS } from "../src/shared/playback.js";
import { defaultAudio, effectiveAudioSource, isInputSource, INPUT_SOURCES } from "../src/shared/input.js";
import { normalizeAsset } from "../src/shared/asset.js";
import { isYouTubeVideoId } from "../src/shared/youtube.js";
import { DEFAULT_PRESENTATION, normalizePresentation } from "../src/shared/presentation.js";

export class ProgramStore {
  private state: ProgramState = {
    videoId: null,
    source: "youtube",
    audio: defaultAudio(),
    mode: "live",
    activeAsset: null,
    revision: 0,
    playback: { status: "playing", position: null, updatedAt: 0, revision: 0 },
    presentation: { ...DEFAULT_PRESENTATION },
  };

  constructor(saved?: (Pick<ProgramState, 'videoId' | 'mode' | 'activeAsset' | 'revision'> & Partial<Pick<ProgramState, 'source' | 'audio' | 'playback' | 'presentation'>>) | null) {
    if (saved) {
      if (saved.videoId !== null && !isYouTubeVideoId(saved.videoId)) throw new Error("Invalid saved video.");
      if (!Number.isSafeInteger(saved.revision) || saved.revision < 0) throw new Error("Invalid saved revision.");
      if (saved.mode !== "live" && saved.mode !== "graphic") throw new Error("Invalid saved mode.");
      const playback: PlaybackState = saved.playback ?? { status: "playing", position: null, updatedAt: 0, revision: 0 };
      if (!['playing', 'paused'].includes(playback.status) || (playback.position !== null && !isVideoTime(playback.position)) ||
        !Number.isSafeInteger(playback.updatedAt) || playback.updatedAt < 0 || !Number.isSafeInteger(playback.revision) || playback.revision < 0) {
        throw new Error("Invalid saved playback.");
      }
      const audio = normalizeAudio(saved.audio);
      // Resume from the saved point after a process restart; downtime is not viewing time.
      this.state = {
        ...saved,
        // Camera sessions and their invite tokens end with the server process.
        source: "youtube",
        audio: { ...audio, followSelected: true, source: 'youtube' },
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
      source: 'youtube',
      playback: { status: "playing", position: null, updatedAt: Date.now(), revision: this.state.playback.revision + 1 },
      revision: this.state.revision + 1,
    };
    return this.getState();
  }

  controlPlayback(value: PlaybackCommand, observedPosition?: number, duration?: number): ProgramState {
    if (this.state.source !== 'youtube') throw new Error('Camera inputs are live. Switch to YouTube for playback controls.');
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

  setSource(source: InputSource, observedPosition?: number): ProgramState {
    if (!isInputSource(source)) throw new Error('Invalid input source.');
    if (source === this.state.source) return this.getState();
    const now = Date.now();
    const position = this.state.source === 'youtube'
      ? (isVideoTime(observedPosition) ? observedPosition : playbackPosition(this.state.playback, now))
      : this.state.playback.position;
    const audio = this.state.audio;
    // A hidden YouTube embed cannot supply audio while a camera is on air.
    const nextAudio = !audio.followSelected && source !== 'youtube' && audio.source === 'youtube'
      ? { ...audio, followSelected: true } : audio;
    this.state = {
      ...this.state, source, audio: nextAudio, revision: this.state.revision + 1,
      playback: { ...this.state.playback, position, updatedAt: now, revision: this.state.playback.revision + 1 },
    };
    return this.getState();
  }

  fallbackToYouTube(disconnected: CameraSource): ProgramState {
    this.setSource('youtube');
    if (!this.state.audio.followSelected && this.state.audio.source === disconnected) {
      return this.setAudio({ followSelected: true });
    }
    return this.getState();
  }

  setAudio(value: { source?: unknown; volume?: unknown; muted?: unknown; followSelected?: unknown; audioSource?: unknown }): ProgramState {
    if (!value || typeof value !== 'object') throw new Error('Invalid audio settings.');
    if (value.source !== undefined && !isInputSource(value.source)) throw new Error('Invalid input source.');
    if (value.audioSource !== undefined && !isInputSource(value.audioSource)) throw new Error('Invalid audio source.');
    if (value.volume !== undefined && (typeof value.volume !== 'number' || !Number.isFinite(value.volume) || value.volume < 0 || value.volume > 100)) throw new Error('Volume must be from 0 to 100.');
    if (value.muted !== undefined && typeof value.muted !== 'boolean') throw new Error('Mute must be true or false.');
    if (value.followSelected !== undefined && typeof value.followSelected !== 'boolean') throw new Error('Follow selected must be true or false.');
    const audio = structuredClone(this.state.audio);
    if (value.source !== undefined) {
      if (value.volume !== undefined) audio.levels[value.source].volume = value.volume as number;
      if (value.muted !== undefined) audio.levels[value.source].muted = value.muted as boolean;
    } else if (value.volume !== undefined || value.muted !== undefined) throw new Error('Choose an input for volume or mute.');
    if (value.followSelected !== undefined) audio.followSelected = value.followSelected as boolean;
    if (value.audioSource !== undefined) audio.source = value.audioSource;
    if (effectiveAudioSource(this.state.source, audio) === 'youtube' && this.state.source !== 'youtube') throw new Error('YouTube audio requires YouTube on Output.');
    this.state = { ...this.state, audio, revision: this.state.revision + 1 };
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

function normalizeAudio(value: unknown): ProgramAudio {
  const audio = defaultAudio();
  if (!value || typeof value !== 'object') return audio;
  const incoming = value as Partial<ProgramAudio>;
  if (typeof incoming.followSelected === 'boolean') audio.followSelected = incoming.followSelected;
  if (isInputSource(incoming.source)) audio.source = incoming.source;
  if (incoming.levels && typeof incoming.levels === 'object') {
    for (const source of INPUT_SOURCES) {
      const level = incoming.levels[source];
      if (level && typeof level.volume === 'number' && Number.isFinite(level.volume) && level.volume >= 0 && level.volume <= 100 && typeof level.muted === 'boolean') {
        audio.levels[source] = { volume: level.volume, muted: level.muted };
      }
    }
  }
  return audio;
}
