import { useEffect, useState } from "react";
import type { Asset, PresentationSettings } from "../shared/types";
import { DEFAULT_PRESENTATION } from "../shared/presentation";
import { parseYouTubeVideoId } from "../shared/youtube";
import { sendCommand } from "../commands";
import { ImageLibrary } from "../components/ImageLibrary";
import { Attribution } from "../components/Attribution";
import { AssetImage } from "../components/AssetImage";
import { useProgram } from "../useProgram";
import { YouTubePlayer } from "../components/YouTubePlayer";
import { appPath } from "../basePath";
import "./director.css";

export function Director() {
  const { program, connected, clockOffset, outputPlayback } = useProgram();
  const [videoInput, setVideoInput] = useState("");
  const [preview, setPreview] = useState<Asset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewVersion, setPreviewVersion] = useState(0);
  const [previewReady, setPreviewReady] = useState(false);
  const [presentation, setPresentation] = useState<PresentationSettings>(() => ({ ...DEFAULT_PRESENTATION }));
  const currentPresentation = program.presentation ?? DEFAULT_PRESENTATION;

  useEffect(() => {
    setPresentation({ ...currentPresentation });
  }, [currentPresentation.layout, currentPresentation.corner, currentPresentation.size, currentPresentation.transition, currentPresentation.fit]);

  function select(asset: Asset) {
    setPreviewReady(false);
    setPreviewVersion(value => value + 1);
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
    const videoId = parseYouTubeVideoId(videoInput);
    if (!videoId) {
      setError("Enter a valid YouTube URL or 11-character video ID.");
      return;
    }

    void command("program:set-video", { videoId });
  }

  function takePreview() {
    if (preview && previewReady && connected) {
      void command("program:take", { asset: preview, presentation });
    }
  }

  function goLive() {
    if (program.mode === "graphic" && connected) void command("program:live");
  }

  const onAirTitle = program.mode === "graphic" && program.activeAsset
    ? program.activeAsset.title
    : program.videoId ? "Main video" : "No video set";
  const onAirLayout = program.mode === "graphic"
    ? ({ shoulder: "Over the shoulder", pip: "Picture in picture", image: "Image only · video audio continues" } as const)[currentPresentation.layout]
    : "Main video · playback controls are shared";

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
          <a className="secondary-button" href={appPath("output")} target="_blank" rel="noreferrer">
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
          <button onClick={setVideo} disabled={!connected}>Set video</button>
        </div>
        {error && <p role="alert" className="error-message setup-error">{error}</p>}
      </section>

      <section className="on-air-strip panel" aria-label="Current on-air program">
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
        <p className="revision">Revision {program.revision}</p>
        <button className="live-button" onClick={goLive} disabled={!connected || program.mode !== "graphic"}>
          <span className="live-dot" /> Back to video
        </button>
      </section>

      <section className="director-workspace" aria-label="Director console">
        <article className="panel library-panel console-library">
          <ImageLibrary preview={preview} select={select} />
        </article>

        <article className="panel monitor-panel console-monitor">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Shared program source</p>
              <h2>Video & playback</h2>
            </div>
            <span className="muted-note">Monitor muted</span>
          </div>
          <YouTubePlayer
            videoId={program.videoId}
            title="Director live monitor"
            muted
            compact
            playback={program.playback}
            connected={connected}
            clockOffset={clockOffset}
            outputPlayback={outputPlayback}
          />
          <p className="playback-independence">Pause, rewind, fast forward, and seek control the shared video. Changing image layout keeps video and audio running.</p>
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
                className={`composition-preview layout-${presentation.layout} fit-${presentation.fit}`}
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
          </div>

          <div className="preview-actions">
            <span>{preview ? previewReady ? "Image loaded and ready to air" : "Wait for the full image to load" : "Choose an image to stage"}</span>
            <button className="take-button" onClick={takePreview} disabled={!preview || !previewReady || !connected}>
              Show image <span aria-hidden="true">· TAKE</span>
            </button>
          </div>
        </article>
      </section>
    </main>
  );
}
