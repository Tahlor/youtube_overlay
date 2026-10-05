import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Asset, CameraSource, InputSource, PlaybackSample, PresentationSettings } from "../shared/types";
import { DEFAULT_PRESENTATION, imageMotionVariant } from "../shared/presentation";
import { CAMERA_SOURCES, INPUT_SOURCES, effectiveAudioSource } from "../shared/input";
import { parseYouTubeVideoId } from "../shared/youtube";
import { sendCommand } from "../commands";
import { socket } from "../socket";
import { ImageLibrary } from "../components/ImageLibrary";
import { Attribution } from "../components/Attribution";
import { AssetImage } from "../components/AssetImage";
import { useProgram } from "../useProgram";
import { useInputReceiver } from "../media/useInputReceiver";
import { useBroadcaster } from "../media/useBroadcaster";
import { YouTubePlayer } from "../components/YouTubePlayer";
import { appPath } from "../basePath";
import { claimDirectorSocket } from "../directorAuth";
import "./director.css";

export function Director() {
  const { program, connected, clockOffset, outputPlayback } = useProgram();
  const [directorClaimed, setDirectorClaimed] = useState(false);
  const [directorUser, setDirectorUser] = useState<string | null>(null);
  const [videoInput, setVideoInput] = useState("");
  const [preview, setPreview] = useState<Asset | null>(null);
  const [previewRevision, setPreviewRevision] = useState(program.revision);
  const [error, setError] = useState<string | null>(null);
  const [previewVersion, setPreviewVersion] = useState(0);
  const [previewReady, setPreviewReady] = useState(false);
  const [presentation, setPresentation] = useState<PresentationSettings>(() => ({ ...DEFAULT_PRESENTATION }));
  const [monitorSample, setMonitorSample] = useState<PlaybackSample | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [availability, setAvailability] = useState<Record<CameraSource, boolean>>({
    phone1: false, phone2: false, phone3: false, phone4: false, director: false,
  });
  const [inviteLinks, setInviteLinks] = useState<Partial<Record<CameraSource, string>>>({});
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [fallbackNotice, setFallbackNotice] = useState<string | null>(null);
  const [audioLevels, setAudioLevels] = useState(() => ({ ...program.audio.levels }));
  const [audioAdjusting, setAudioAdjusting] = useState<InputSource | null>(null);
  const audioLevelRef = useRef(audioLevels);
  const cameraPreview = useRef<HTMLVideoElement>(null);
  const localPreview = useRef<HTMLVideoElement>(null);
  const lastProgramSource = useRef(program.source);
  const inviteRequestVersion = useRef(0);
  const broadcaster = useBroadcaster();
  const isYouTubeSelected = program.source === "youtube";
  const shouldWatchInput = directorClaimed && !isYouTubeSelected && !(program.source === "director" && broadcaster.localStream);
  const receiver = useInputReceiver(shouldWatchInput ? program.source : null, shouldWatchInput, "video");
  const directorStream = broadcaster.localStream ?? broadcaster.stream ?? null;
  const previewStream = program.source === "director" ? (directorStream ?? receiver.stream) : receiver.stream;
  const audio = program.audio;
  const effectiveAudio = effectiveAudioSource(program.source, audio);
  const currentPresentation = program.presentation ?? DEFAULT_PRESENTATION;

  useEffect(() => {
    const next = { ...program.audio.levels };
    if (audioAdjusting !== null) next[audioAdjusting] = audioLevelRef.current[audioAdjusting];
    audioLevelRef.current = next;
    setAudioLevels(next);
  }, [program.audio.levels, audioAdjusting]);

  useEffect(() => {
    let claimVersion = 0;
    const claimDirector = () => {
      const version = ++claimVersion;
      setDirectorClaimed(false);
      setDirectorUser(null);
      void claimDirectorSocket().then(user => {
        if (version !== claimVersion) return;
        setDirectorClaimed(true);
        setDirectorUser(user);
        setInputError(null);
      }).catch(failure => {
        if (version !== claimVersion) return;
        setDirectorClaimed(false);
        setDirectorUser(null);
        setInputError(failure instanceof Error ? failure.message : "Webapps sign-in is required for Director access.");
      });
    };
    const onDisconnect = () => {
      claimVersion += 1;
      setDirectorClaimed(false);
      setDirectorUser(null);
      inviteRequestVersion.current += 1;
      setInviteLinks({});
      setInviteBusy(false);
      setInviteError(null);
      setCopyMessage(null);
      setAvailability({ phone1: false, phone2: false, phone3: false, phone4: false, director: false });
    };
    const onAvailability = (next: Partial<Record<CameraSource, boolean>>) => {
      setAvailability(current => ({ ...current, ...next }));
    };
    socket.on("connect", claimDirector);
    socket.on("disconnect", onDisconnect);
    socket.on("input:availability", onAvailability);
    if (socket.connected) claimDirector();
    return () => {
      claimVersion += 1;
      socket.off("connect", claimDirector);
      socket.off("disconnect", onDisconnect);
      socket.off("input:availability", onAvailability);
    };
  }, []);

  useEffect(() => {
    const previous = lastProgramSource.current;
    if (previous !== "youtube" && program.source === "youtube" && !availability[previous]) {
      setFallbackNotice(`${sourceLabel(previous)} disconnected. Output returned to the saved YouTube video.`);
    }
    lastProgramSource.current = program.source;
  }, [program.source, availability]);

  useEffect(() => {
    if (cameraPreview.current) {
      cameraPreview.current.srcObject = previewStream;
      if (previewStream) void cameraPreview.current.play().catch(() => undefined);
    }
    if (localPreview.current) {
      localPreview.current.srcObject = directorStream;
      if (directorStream) void localPreview.current.play().catch(() => undefined);
    }
  }, [previewStream, directorStream]);

  // Program changes should not silently rewrite an already-staged private draft.
  useEffect(() => {
    if (!preview) setPresentation({ ...currentPresentation });
  }, [preview, currentPresentation.layout, currentPresentation.corner, currentPresentation.size, currentPresentation.transition, currentPresentation.fit, currentPresentation.motion]);

  function select(asset: Asset) {
    setPreviewReady(false);
    setPreviewVersion(value => value + 1);
    setPreviewRevision(program.revision);
    setPresentation(current => ({
      ...DEFAULT_PRESENTATION,
      transition: current.transition === 'cut' ? 'cut' : 'fade',
      motion: 'auto',
    }));
    setPreview(asset);
  }

  async function command(event: string, payload?: unknown) {
    setError(null);
    try {
      await sendCommand(event, payload);
    } catch (failure) {
      setError((failure as Error).message);
    }
  }

  function setVideo() {
    if (!directorClaimed) {
      setError("Webapps sign-in is required before changing the program.");
      return;
    }
    const videoId = parseYouTubeVideoId(videoInput);
    if (!videoId) {
      setError("Enter a valid YouTube URL or 11-character video ID.");
      return;
    }

    void command("program:set-video", { videoId });
  }

  function selectSource(source: InputSource) {
    if (!directorClaimed) return;
    setInputError(null);
    setFallbackNotice(null);
    void command("program:set-source", { source });
  }

  async function startDirectorInput() {
    setInputError(null);
    try {
      await broadcaster.start({ source: "director" });
    } catch (failure) {
      setInputError((failure as Error).message || "Could not start the director camera.");
    }
  }

  function requestPhoneInvites() {
    if (!connected || !directorClaimed || inviteBusy) return;
    setInviteBusy(true);
    setInviteError(null);
    setCopyMessage(null);
    const requestVersion = ++inviteRequestVersion.current;
    socket.timeout(5000).emit("input:invites", (timeout: Error | null, response?: {
      ok?: boolean;
      links?: Partial<Record<CameraSource, string>>;
      error?: string;
    }) => {
      if (requestVersion !== inviteRequestVersion.current) return;
      setInviteBusy(false);
      if (timeout || !response?.ok || !response.links) {
        setInviteError(response?.error ?? "Could not create phone links. Reconnect and try again.");
        return;
      }
      setInviteLinks(response.links);
    });
  }

  async function copyInvite(source: CameraSource) {
    const link = inviteLinks[source];
    if (!link) return;
    try {
      await navigator.clipboard.writeText(new URL(link, window.location.origin).toString());
      setCopyMessage(`${sourceLabel(source)} link copied`);
    } catch {
      setCopyMessage("Clipboard access is unavailable. Select and copy the link.");
    }
  }

  function updateAudioLevel(source: InputSource, update: { volume?: number; muted?: boolean }) {
    const next = { ...audioLevelRef.current, [source]: { ...audioLevelRef.current[source], ...update } };
    audioLevelRef.current = next;
    setAudioLevels(next);
  }

  function saveAudioVolume(source: InputSource) {
    void command("program:set-audio", { source, volume: audioLevelRef.current[source].volume })
      .finally(() => setAudioAdjusting(null));
  }

  function takePreview() {
    if (preview && previewReady && connected && directorClaimed) {
      void command("program:take", { asset: preview, presentation, expectedRevision: previewRevision });
    }
  }

  function goLive() {
    if (connected && directorClaimed) void command("program:live", { expectedRevision: program.revision });
  }

  async function forceSync() {
    if (!connected || !directorClaimed || !isYouTubeSelected || !program.videoId || syncing) return;
    setSyncing(true);
    setError(null);
    try {
      await sendCommand("program:force-sync");
      setSyncNotice("Synced");
      setTimeout(() => setSyncNotice(null), 2000);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  const togglePlayPause = useCallback(async () => {
    if (!connected || !isYouTubeSelected || !program.videoId) return;
    try {
      const action = program.playback.status === 'playing' ? 'pause' : 'play';
      const position = monitorSample?.currentTime;
      await sendCommand('program:playback', {
        videoId: program.videoId,
        playbackRevision: program.playback.revision,
        action,
        ...(typeof position === 'number' ? { position } : {})
      });
    } catch (failure) {
      setError((failure as Error).message);
    }
  }, [connected, isYouTubeSelected, program.videoId, program.playback.status, program.playback.revision, monitorSample?.currentTime]);

  const skipVideo = useCallback(async (seconds: number) => {
    if (!connected || !isYouTubeSelected || !program.videoId) return;
    try {
      await sendCommand('program:playback', {
        videoId: program.videoId,
        playbackRevision: program.playback.revision,
        action: 'skip',
        seconds
      });
    } catch (failure) {
      setError((failure as Error).message);
    }
  }, [connected, isYouTubeSelected, program.videoId, program.playback.revision]);

  const seekLive = useCallback(async () => {
    if (!connected || !isYouTubeSelected || !program.videoId) return;
    try {
      const dur = monitorSample?.duration;
      await sendCommand('program:playback', {
        videoId: program.videoId,
        playbackRevision: program.playback.revision,
        action: 'live',
        ...(typeof dur === 'number' && dur > 0 ? { position: dur } : {})
      });
    } catch (failure) {
      setError((failure as Error).message);
    }
  }, [connected, isYouTubeSelected, program.videoId, program.playback.revision, monitorSample?.duration]);

  // Global keyboard shortcuts for switching, playback, and layouts
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isInput = target && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable ||
        (target.tagName === 'SELECT' && event.key !== 'Escape')
      );

      if (event.key === 'Escape') {
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
          target.blur();
          return;
        }
        if (program.mode === "graphic" && connected && directorClaimed) {
          event.preventDefault();
          goLive();
        }
        return;
      }

      if (isInput) return;

      if (event.key === 'Enter') {
        if (preview && previewReady && connected && directorClaimed) {
          event.preventDefault();
          takePreview();
        }
      } else if (event.key === ' ' || event.code === 'Space') {
        event.preventDefault();
        void togglePlayPause();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        void skipVideo(-10);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        void skipVideo(10);
      } else if (event.key === 'l' || event.key === 'L') {
        event.preventDefault();
        void seekLive();
      } else if (event.key === 's' || event.key === 'S') {
        event.preventDefault();
        void forceSync();
      } else if (event.key === '1') {
        event.preventDefault();
        setPresentation(p => ({ ...p, layout: 'shoulder' }));
      } else if (event.key === '2') {
        event.preventDefault();
        setPresentation(p => ({ ...p, layout: 'pip' }));
      } else if (event.key === '3') {
        event.preventDefault();
        setPresentation(p => ({ ...p, layout: 'image' }));
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [connected, directorClaimed, preview, previewReady, previewRevision, program.mode, program.revision, program.videoId, togglePlayPause, skipVideo, seekLive]);

  const onAirTitle = program.mode === "graphic" && program.activeAsset
    ? program.activeAsset.title
    : isYouTubeSelected ? (program.videoId ? "Main video" : "No video set") : `${sourceLabel(program.source)} camera`;
  const onAirLayout = program.mode === "graphic"
    ? ({ shoulder: "Over the shoulder", pip: "Picture in picture", image: "Image only · video audio continues" } as const)[currentPresentation.layout]
    : isYouTubeSelected ? "Main video · playback controls are shared" : "Live camera · pause and seek are unavailable";

  const outputSourceName = useMemo(() => sourceLabel(program.source), [program.source]);

  const syncDrift = (isYouTubeSelected && outputPlayback && monitorSample && outputPlayback.videoId === monitorSample.videoId)
    ? Math.abs(outputPlayback.currentTime - monitorSample.currentTime)
    : null;

  const previewMotionVariant = preview ? imageMotionVariant(preview) : 0;

  return (
    <main className="director-shell compact-director">
      <header className="topbar director-topbar">
        <div className="director-title">
          <p className="eyebrow">General Conference</p>
          <h1>Director</h1>
        </div>
        <div className="topbar-actions">
          <span className={`connection ${connected ? "online" : "offline"}`}>
            {connected ? "Connected" : "Reconnecting…"}
          </span>
          <span className={`connection ${directorClaimed ? "online" : "offline"}`} title="Authenticated by Webapps/SSO">
            {directorClaimed ? `SSO · ${directorUser ?? "Director"}` : "Checking SSO…"}
          </span>
          <a className="secondary-button" href={appPath("output")} target="_blank" rel="noreferrer" title="Open TV presentation screen in a new window">
            Open TV output
          </a>
        </div>
      </header>

      <section className="video-setup panel director-setup" aria-label="Video setup">
        <label htmlFor="youtube-url">YouTube stream or video</label>
        <div className="input-row">
          <input
            id="youtube-url"
            value={videoInput}
            onChange={(event) => setVideoInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") setVideo();
            }}
            placeholder="Paste a YouTube URL or video ID"
          />
          <button onClick={setVideo} disabled={!connected || !directorClaimed} title="Load specified YouTube video">Set video</button>
        </div>
        {error && <p role="alert" className="error-message setup-error">{error}</p>}
      </section>

      <section className="on-air-strip panel master-switcher" aria-label="Master broadcast switcher and on-air program">
        <div className="on-air-status">
          <span className={`program-badge ${program.mode}`}>{program.mode === "graphic" ? "IMAGE ON AIR" : "LIVE VIDEO"}</span>
          {program.mode === "graphic" && program.activeAsset ? (
            <AssetImage asset={program.activeAsset} thumbnail />
          ) : (
            <div className="on-air-video-icon" aria-hidden="true">▶</div>
          )}
          <div className="on-air-copy">
            <span className="eyebrow">On TV now</span>
            <strong title={onAirTitle}>{onAirTitle}</strong>
            <span>{onAirLayout}</span>
          </div>
        </div>

        <div className="master-controls" role="toolbar" aria-label="Centralized broadcast switching controls">
          <div className="staged-status-pill" title={preview ? `Staged: ${preview.title}` : "Select an image from the library"}>
            <span className="eyebrow">Staged</span>
            <strong>{preview ? preview.title : "None"}</strong>
            <span className={`staged-tag ${previewReady ? "is-ready" : ""}`}>
              {preview ? (previewReady ? "Ready" : "Loading…") : "Empty"}
            </span>
          </div>

          <button
            className="take-button"
            onClick={takePreview}
            disabled={!preview || !previewReady || !connected || !directorClaimed}
            title="Take staged image to TV · TAKE (Enter)"
            aria-label="Show image on TV (Enter)"
          >
            Show image <span className="kbd-hint">TAKE · ↵</span>
          </button>

          <button
            className="live-button"
            onClick={goLive}
            disabled={!connected || !directorClaimed}
            title="Return to the main source (Escape)"
            aria-label="Return to main source (Escape)"
          >
            <span className="live-dot" /> Main source <span className="kbd-hint">Esc</span>
          </button>

          <div className="quick-layouts" role="group" aria-label="Quick layout selector">
            <button
              type="button"
              className={`layout-pill ${presentation.layout === 'shoulder' ? 'active' : ''}`}
              onClick={() => setPresentation(p => ({ ...p, layout: 'shoulder' }))}
              title="Over the shoulder layout (1)"
              aria-label="Over the shoulder (1)"
            >
              Shoulder <kbd>1</kbd>
            </button>
            <button
              type="button"
              className={`layout-pill ${presentation.layout === 'pip' ? 'active' : ''}`}
              onClick={() => setPresentation(p => ({ ...p, layout: 'pip' }))}
              title="Picture in picture layout (2)"
              aria-label="Picture in picture (2)"
            >
              PiP <kbd>2</kbd>
            </button>
            <button
              type="button"
              className={`layout-pill ${presentation.layout === 'image' ? 'active' : ''}`}
              onClick={() => setPresentation(p => ({ ...p, layout: 'image' }))}
              title="Image only layout (3)"
              aria-label="Image only (3)"
            >
              Image <kbd>3</kbd>
            </button>
          </div>

          <button
            type="button"
            className={`force-sync-btn ${syncDrift && syncDrift >= 1.5 ? 'drift-warn' : ''}`}
            onClick={forceSync}
            disabled={!connected || !directorClaimed || !isYouTubeSelected || !program.videoId || syncing}
            title="Force TV output and Director monitor into sync (S)"
            aria-label="Force synchronize stream (S)"
          >
            🔄 {syncNotice ?? (syncing ? "Syncing…" : "Force Sync")}
            {syncDrift !== null && <span className="sync-drift-tag">{syncDrift < 1.0 ? "✓ Sync" : `Δ${syncDrift.toFixed(1)}s`}</span>}
            <kbd>S</kbd>
          </button>
        </div>

        <div className="strip-end">
          <p className="revision">Revision {program.revision}</p>
          <details className="shortcuts-help">
            <summary title="Keyboard shortcuts guide" aria-label="Keyboard shortcuts guide">⌨</summary>
            <div className="shortcuts-popover" role="tooltip">
              <strong>Shortcuts</strong>
              <ul>
                <li><kbd>Enter</kbd> <span>TAKE staged image</span></li>
                <li><kbd>Esc</kbd> <span>Return to main source</span></li>
                <li><kbd>Space</kbd> <span>Play / Pause</span></li>
                <li><kbd>←</kbd> <kbd>→</kbd> <span>Skip 10s</span></li>
                <li><kbd>L</kbd> <span>Seek to Live</span></li>
                <li><kbd>S</kbd> <span>Force Sync</span></li>
                <li><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> <span>Layouts</span></li>
              </ul>
            </div>
          </details>
        </div>
      </section>

      <section className="director-workspace" aria-label="Director console">
        <article className="panel library-panel console-library">
          <ImageLibrary preview={preview} select={select} />
        </article>

        <article className="panel monitor-panel console-monitor">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Output source · {outputSourceName}</p>
              <h2>Video & playback</h2>
            </div>
            <span className="muted-note">Preview muted</span>
          </div>
          {fallbackNotice && <p className="camera-fallback-notice" role="status">{fallbackNotice}</p>}

          <div className="source-selector" role="group" aria-label="Choose the video source for Output">
            {INPUT_SOURCES.map(source => {
              const live = source === "youtube" || availability[source as CameraSource];
              const selected = program.source === source;
              return (
                <button
                  key={source}
                  type="button"
                  title={sourceLabel(source)}
                  aria-label={sourceLabel(source)}
                  className={`source-choice ${selected ? "selected" : ""}`}
                  aria-pressed={selected}
                  onClick={() => selectSource(source)}
                  disabled={!connected || !directorClaimed}
                >
                  <span className={`source-dot ${live ? "source-online" : "source-offline"}`} aria-hidden="true" />
                  <span>{source === 'director' ? 'Webcam' : sourceLabel(source)}</span>
                  <small>{source === "youtube" ? "Saved" : live ? "Live" : "Offline"}</small>
                </button>
              );
            })}
          </div>

          {isYouTubeSelected ? (
            <>
              <YouTubePlayer
                videoId={program.videoId}
                title="Director live monitor"
                muted
                compact
                playback={program.playback}
                connected={connected}
                clockOffset={clockOffset}
                outputPlayback={outputPlayback}
                onSample={setMonitorSample}
              />
              <p className="playback-independence">Pause, rewind, fast forward, and seek control the shared video. Image layouts keep its video and audio running.</p>
            </>
          ) : (
            <div className="camera-monitor">
              {previewStream ? (
                <video ref={cameraPreview} className="input-preview" muted playsInline autoPlay aria-label={`${sourceLabel(program.source)} camera preview`} />
              ) : (
                <div className="input-preview-empty">
                  <span className="camera-preview-icon" aria-hidden="true">◉</span>
                  <strong>{availability[program.source as CameraSource] ? "Connecting to live camera…" : `${sourceLabel(program.source)} is offline`}</strong>
                  <span>{receiver.error ?? "The saved YouTube video stays available from the source selector."}</span>
                </div>
              )}
              <p className="playback-independence">Live camera feed. Pause, rewind, and seek are unavailable. Your YouTube video and its playback position are saved.</p>
              {receiver.error && <p className="input-error" role="alert">{receiver.error}</p>}
              {receiver.failed && directorClaimed && (
                <button type="button" className="input-retry" onClick={receiver.retry}>
                  Retry camera connection
                </button>
              )}
            </div>
          )}

          <div className="director-input-strip">
            {directorStream && program.source !== "director" && (
              <video ref={localPreview} className="director-local-preview" muted playsInline autoPlay aria-label="Muted director local preview" />
            )}
            <div className="director-input-status">
              <strong>Director webcam</strong>
              <span className={`camera-state ${broadcaster.status === "ready" ? "camera-ready" : ""} ${broadcaster.error || inputError ? "camera-error" : ""}`} role={broadcaster.error || inputError ? "alert" : "status"}>
                {broadcaster.error ?? inputError ?? (directorStream ? `Local preview muted · ${broadcaster.status}` : broadcaster.status)}
              </span>
            </div>
            {directorStream ? (
              <button type="button" className="camera-stop" onClick={broadcaster.stop}>Stop webcam</button>
            ) : (
              <button type="button" onClick={() => void startDirectorInput()} disabled={!connected || !directorClaimed || broadcaster.status === "requesting" || broadcaster.status === "connecting"}>
                {broadcaster.status === "requesting" ? "Waiting for permission…" : "Start webcam"}
              </button>
            )}
          </div>

          <div className="audio-routing">
            <label className="follow-audio">
              <input
                type="checkbox"
                checked={audio.followSelected}
                disabled={!connected || !directorClaimed}
                onChange={event => void command("program:set-audio", event.target.checked
                  ? { followSelected: true }
                  : { followSelected: false, audioSource: program.source })}
              />
              <span>Follow selected source audio</span>
            </label>
            <label className="audio-route-label">
              <span>Audio from</span>
              <select
                aria-label="Audio source"
                value={audio.source}
                disabled={!connected || !directorClaimed || audio.followSelected}
                onChange={event => void command("program:set-audio", { audioSource: event.target.value as InputSource })}
              >
                {INPUT_SOURCES.map(source => (
                  <option key={source} value={source} disabled={source === "youtube" && !isYouTubeSelected}>{sourceLabel(source)}</option>
                ))}
              </select>
            </label>
            <span className="audio-active">Active: {sourceLabel(effectiveAudio)} audio</span>
          </div>

          <details className="audio-mixer">
            <summary>Per-input volume and mute</summary>
            <div className="audio-mixer-list">
              {INPUT_SOURCES.map(source => {
                const level = audioLevels[source];
                return (
                  <div className="audio-mixer-row" key={source}>
                    <strong>{sourceLabel(source)}</strong>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={level.volume}
                      aria-label={`${sourceLabel(source)} volume`}
                      onPointerDown={() => setAudioAdjusting(source)}
                      onChange={event => updateAudioLevel(source, { volume: Number(event.target.value) })}
                      onPointerUp={() => saveAudioVolume(source)}
                      onKeyDown={() => setAudioAdjusting(source)}
                      onKeyUp={() => saveAudioVolume(source)}
                      onBlur={() => { if (audioAdjusting === source) saveAudioVolume(source); }}
                      disabled={!connected || !directorClaimed}
                    />
                    <output>{level.volume}%</output>
                    <button
                      type="button"
                      className={level.muted ? "audio-muted" : ""}
                      aria-pressed={level.muted}
                      disabled={!connected || !directorClaimed}
                      onClick={() => void command("program:set-audio", { source, muted: !level.muted })}
                    >{level.muted ? "Muted" : "Mute"}</button>
                  </div>
                );
              })}
            </div>
          </details>

          <details className="phone-invites">
            <summary>Phone camera links</summary>
            <div className="phone-invite-content">
              <p>Each link is private to this session and opens one assigned phone input.</p>
              {!directorClaimed && <p className="input-error" role="status">Webapps sign-in is required to create input links.</p>}
              <button type="button" onClick={requestPhoneInvites} disabled={!connected || !directorClaimed || inviteBusy}>
                {inviteBusy ? "Creating links…" : Object.keys(inviteLinks).length ? "Refresh phone links" : "Create phone links"}
              </button>
              {inviteError && <p className="input-error" role="alert">{inviteError}</p>}
              {CAMERA_SOURCES.filter(source => source !== "director").map(source => (
                inviteLinks[source] ? (
                  <div className="phone-invite-row" key={source}>
                    <label htmlFor={`invite-${source}`}>{sourceLabel(source)}</label>
                    <input id={`invite-${source}`} readOnly value={new URL(inviteLinks[source]!, window.location.origin).toString()} onFocus={event => event.currentTarget.select()} />
                    <button type="button" onClick={() => void copyInvite(source)}>Copy</button>
                  </div>
                ) : null
              ))}
              {copyMessage && <span className="copy-message" role="status">{copyMessage}</span>}
            </div>
          </details>
        </article>

        <article className="panel preview-panel console-preview">
          <div className="panel-heading preview-heading">
            <div>
              <p className="eyebrow">Staged · private until TAKE</p>
              <h2>Program preview</h2>
            </div>
            <span className={`staged-indicator ${previewReady ? "ready" : ""}`}>{previewReady ? "Ready" : preview ? "Loading image…" : "No image"}</span>
          </div>

          {preview ? (
            <div className="preview-content">
              <div
                className={`composition-preview layout-${presentation.layout} fit-${presentation.fit} motion-${presentation.motion ?? 'auto'} motion-variant-${previewMotionVariant}`}
                aria-label={`Staged ${presentation.layout} composition preview`}
              >
                {presentation.layout !== "image" && (
                  <div className="video-scene" aria-hidden="true">
                    <span>MAIN VIDEO · AUDIO CONTINUES</span>
                  </div>
                )}
                <div className={`presentation-asset corner-${presentation.corner} size-${presentation.size}`}>
                  <AssetImage key={previewVersion} asset={preview} onReady={setPreviewReady} />
                </div>
                {presentation.layout === "pip" && (
                  <div className={`video-inset corner-${presentation.corner} size-${presentation.size}`} aria-hidden="true">
                    <span>VIDEO</span>
                  </div>
                )}
              </div>
              <div className="preview-asset-info">
                <strong title={preview.title}>{preview.title}</strong>
                <Attribution asset={preview} />
              </div>
            </div>
          ) : (
            <div className="empty-preview">Select an image from the library. The TV stays on its current program until you press Show image.</div>
          )}

          <div className="presentation-controls" aria-label="Image presentation settings">
            <label>
              <span>Layout</span>
              <select aria-label="Image layout" value={presentation.layout} onChange={event => setPresentation(value => ({ ...value, layout: event.target.value as PresentationSettings["layout"] }))}>
                <option value="shoulder">Over the shoulder</option>
                <option value="pip">Picture in picture</option>
                <option value="image">Image only</option>
              </select>
            </label>
            <label>
              <span>Position</span>
              <select aria-label="Corner" value={presentation.corner} onChange={event => setPresentation(value => ({ ...value, corner: event.target.value as PresentationSettings["corner"] }))}>
                <option value="top-left">Top left</option>
                <option value="top-right">Top right</option>
                <option value="bottom-left">Bottom left</option>
                <option value="bottom-right">Bottom right</option>
              </select>
            </label>
            <label>
              <span>Size</span>
              <select aria-label="Image size" value={presentation.size} onChange={event => setPresentation(value => ({ ...value, size: event.target.value as PresentationSettings["size"] }))}>
                <option value="small">Small</option>
                <option value="medium">Medium</option>
                <option value="large">Large</option>
              </select>
            </label>
            <label>
              <span>Transition</span>
              <select aria-label="Transition" value={presentation.transition} onChange={event => setPresentation(value => ({ ...value, transition: event.target.value as PresentationSettings["transition"] }))}>
                <option value="cut">Cut</option>
                <option value="fade">Fade</option>
                <option value="slide">Slide</option>
              </select>
            </label>
            <label>
              <span>Image fit</span>
              <select aria-label="Image fit" value={presentation.fit} onChange={event => setPresentation(value => ({ ...value, fit: event.target.value as PresentationSettings["fit"] }))}>
                <option value="contain">Fit whole image</option>
                <option value="cover">Fill frame</option>
              </select>
            </label>
            <label>
              <span>Motion</span>
              <select aria-label="Image motion" value={presentation.motion ?? 'auto'} onChange={event => setPresentation(value => ({ ...value, motion: event.target.value as NonNullable<PresentationSettings["motion"]> }))}>
                <option value="auto">Auto motion</option>
                <option value="still">Still</option>
              </select>
            </label>
          </div>

          <div className="preview-actions">
            <span>{preview ? previewReady ? "Image loaded and ready to air" : "Wait for the full image to load" : "Choose an image to stage"}</span>
            <button type="button" className="stage-take-trigger" onClick={takePreview} disabled={!preview || !previewReady || !connected || !directorClaimed} title="Take staged image to TV · TAKE (Enter)">
              Show image <span aria-hidden="true">· TAKE ↵</span>
            </button>
          </div>
        </article>
      </section>
    </main>
  );
}

function sourceLabel(source: InputSource): string {
  if (source === "youtube") return "YouTube";
  if (source === "director") return "Director webcam";
  return `Phone ${source.slice(-1)}`;
}
