import { useState } from "react";
import type { Asset, CommandAck } from "../shared/types";
import { parseYouTubeVideoId } from "../shared/youtube";
import { socket } from "../socket";
import { useProgram } from "../useProgram";
import { YouTubePlayer } from "../components/YouTubePlayer";

const TEST_ASSET: Asset = {
  id: "m0-test-graphic",
  title: "General Conference Director test graphic",
  fullUrl: "/test-graphic.svg",
  thumbnailUrl: "/test-graphic.svg",
  source: "Built in",
};

export function Director() {
  const { program, connected } = useProgram();
  const [videoInput, setVideoInput] = useState("");
  const [preview, setPreview] = useState<Asset | null>(null);
  const [error, setError] = useState<string | null>(null);

  function setVideo() {
    const videoId = parseYouTubeVideoId(videoInput);
    if (!videoId) {
      setError("Enter a valid YouTube URL or 11-character video ID.");
      return;
    }

    setError(null);
    socket.emit("program:set-video", { videoId }, (result: CommandAck) => {
      if (!result.ok) setError(result.error ?? "Could not update the video.");
    });
  }

  function takePreview() {
    if (!preview) return;
    setError(null);
    socket.emit("program:take", { asset: preview }, (result: CommandAck) => {
      if (!result.ok) setError(result.error ?? "Could not take the graphic.");
    });
  }

  function goLive() {
    setError(null);
    socket.emit("program:live", (result: CommandAck) => {
      if (!result.ok) setError(result.error ?? "Could not return to LIVE.");
    });
  }

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
          <a className="secondary-button" href="/output" target="_blank" rel="noreferrer">
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
          <button onClick={setVideo}>Set video</button>
        </div>
        {error && <p className="error-message">{error}</p>}
      </section>

      <section className="director-grid">
        <article className="panel monitor-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Monitor</p>
              <h2>Live feed</h2>
            </div>
            <span className="muted-note">Director audio muted</span>
          </div>
          <YouTubePlayer videoId={program.videoId} title="Director live monitor" muted />
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
            <img src={program.activeAsset.thumbnailUrl ?? program.activeAsset.fullUrl} alt={program.activeAsset.title} />
          ) : (
            <div className="live-card">LIVE VIDEO</div>
          )}
          <p className="revision">Revision {program.revision}</p>
        </article>
      </section>

      <section className="switcher-grid">
        <article className="panel library-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">M0 graphics</p>
              <h2>Built-in test graphic</h2>
            </div>
          </div>
          <button className="asset-card" onClick={() => setPreview(TEST_ASSET)}>
            <img src={TEST_ASSET.thumbnailUrl} alt={TEST_ASSET.title} />
            <span>Load into Preview</span>
          </button>
          <p className="muted-note search-coming">Image search arrives in M1.</p>
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
              <img src={preview.fullUrl} alt={preview.title} />
              <strong>{preview.title}</strong>
            </div>
          ) : (
            <div className="empty-preview">Select a graphic. Nothing changes on the TV until you press TAKE.</div>
          )}
        </article>
      </section>

      <footer className="control-dock">
        <button className="live-button" onClick={goLive} disabled={!connected}>
          <span className="live-dot" /> LIVE
        </button>
        <div className="dock-status">
          <span>Preview</span>
          <strong>{preview?.title ?? "Nothing selected"}</strong>
        </div>
        <button className="take-button" onClick={takePreview} disabled={!preview || !connected}>
          TAKE ▶
        </button>
      </footer>
    </main>
  );
}
