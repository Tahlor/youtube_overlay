import { useProgram } from "../useProgram";
import { YouTubePlayer } from "../components/YouTubePlayer";

export function Output() {
  const { program, connected } = useProgram();
  const graphicActive = program.mode === "graphic" && program.activeAsset;

  return (
    <main className={`output-shell ${graphicActive ? "graphic-mode" : "live-mode"}`}>
      {!connected && <div className="connection-ribbon">Reconnecting to Director…</div>}

      {graphicActive ? (
        <>
          <section className="program-graphic">
            <img src={program.activeAsset!.fullUrl} alt={program.activeAsset!.title} />
            <div className="graphic-caption">
              <strong>{program.activeAsset!.title}</strong>
              {program.activeAsset!.source && <span>{program.activeAsset!.source}</span>}
            </div>
          </section>
          <aside className="program-live-side">
            <div className="live-label"><span /> LIVE</div>
            <YouTubePlayer videoId={program.videoId} title="Live program video" />
          </aside>
        </>
      ) : (
        <YouTubePlayer videoId={program.videoId} title="Live program video" className="program-video" />
      )}
    </main>
  );
}
