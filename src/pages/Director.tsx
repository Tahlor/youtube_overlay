import { useState } from "react";
import type { Asset } from "../shared/types";
import { parseYouTubeVideoId } from "../shared/youtube";
import { sendCommand } from "../commands";
import { ImageLibrary } from "../components/ImageLibrary";
import { Attribution } from "../components/Attribution";
import { AssetImage } from "../components/AssetImage";
import { useProgram } from "../useProgram";
import { YouTubePlayer } from "../components/YouTubePlayer";
import { appPath } from "../basePath";

export function Director() {
  const { program, connected, clockOffset, outputPlayback } = useProgram();
  const [videoInput, setVideoInput] = useState("");
  const [preview, setPreview] = useState<Asset | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [previewVersion, setPreviewVersion] = useState(0);
  const [previewReady, setPreviewReady] = useState(false);
  function select(asset: Asset) { setPreviewReady(false); setPreviewVersion(value => value + 1); setPreview(asset); }

  async function command(event: string, payload?: unknown) {
    setError(null);
    try { await sendCommand(event, payload); } catch (error) { setError((error as Error).message); }
  }

  function setVideo() {
    const videoId = parseYouTubeVideoId(videoInput);
    if (!videoId) {
      setError("Enter a valid YouTube URL or 11-character video ID.");
      return;
    }

    void command("program:set-video", { videoId });
  }
  function takePreview() { if (preview && previewReady) void command("program:take", { asset: preview }); }
  function goLive() { void command("program:live"); }

  return (
    <main className="director-shell">
      <header className="topbar">
        <div>
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

      <section className="video-setup panel">
        <label htmlFor="youtube-url">YouTube stream or video</label>
        <div className="input-row">
          <input
            id="youtube-url"
            value={videoInput}
            onChange={(event) => setVideoInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") setVideo();
            }}
            placeholder="Paste youtube.com/watch, youtube.com/live, youtu.be, or a video ID"
          />
          <button onClick={setVideo} disabled={!connected}>Set video</button>
        </div>
        {error && <p role="alert" className="error-message">{error}</p>}
      </section>

      <section className="director-grid">
        <article className="panel monitor-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Monitor</p>
              <h2>Video & playback</h2>
            </div>
            <span className="muted-note">Director audio muted</span>
          </div>
          <YouTubePlayer videoId={program.videoId} title="Director live monitor" muted playback={program.playback} connected={connected} clockOffset={clockOffset} outputPlayback={outputPlayback} />
        </article>

        <article className="panel program-status">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">On TV now</p>
              <h2>Program</h2>
            </div>
            <span className={`program-badge ${program.mode}`}>{program.mode.toUpperCase()}</span>
          </div>
          {program.mode === "graphic" && program.activeAsset ? (
            <AssetImage asset={program.activeAsset} thumbnail />
          ) : (
            <div className="live-card">LIVE VIDEO</div>
          )}
          <p className="revision">Revision {program.revision}</p>
        </article>
      </section>

      <section className="switcher-grid">
        <article className="panel library-panel">
          <ImageLibrary preview={preview} select={select} />
        </article>

        <article className="panel preview-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Safe workspace</p>
              <h2>Preview</h2>
            </div>
          </div>
          {preview ? (
            <div className="preview-content">
              <AssetImage key={previewVersion} asset={preview} onReady={setPreviewReady} />
              <strong>{preview.title}</strong>
              <Attribution asset={preview} />
            </div>
          ) : (
            <div className="empty-preview">Select a graphic. Nothing changes on the TV until you press TAKE.</div>
          )}
        </article>
      </section>

      <footer className="control-dock">
        <button className="live-button" onClick={goLive}>
          <span className="live-dot" /> LIVE
        </button>
        <div className="dock-status">
          <span>Preview</span>
          <strong>{preview?.title ?? "Nothing selected"}</strong>
        </div>
        <button className="take-button" onClick={takePreview} disabled={!preview || !previewReady || !connected}>
          TAKE ▶
        </button>
      </footer>
    </main>
  );
}
