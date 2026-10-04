import { useProgram } from '../useProgram';
import { YouTubePlayer } from '../components/YouTubePlayer';
import { AssetImage } from '../components/AssetImage';
import { Attribution } from '../components/Attribution';

export function Output() {
  const { program, connected, clockOffset, reportPlayback } = useProgram();
  const graphicActive = program.mode === 'graphic' && program.activeAsset;
  return <main className={`output-shell ${graphicActive ? 'graphic-mode' : 'live-mode'}`}>
    {!connected && <div className="connection-ribbon" role="status">Reconnecting to Director… Keeping current Program.</div>}
    {graphicActive && <section className="program-graphic">
      <AssetImage asset={program.activeAsset!} />
      <div className="graphic-caption"><strong>{program.activeAsset!.title}</strong><Attribution asset={program.activeAsset!}/></div>
    </section>}
    <aside className="program-live-side">
      {graphicActive && <div className="live-label"><span /> {program.playback.status === 'paused' ? 'PAUSED' : 'VIDEO'}</div>}
      <YouTubePlayer videoId={program.videoId} title="Live program video" className="program-video" playback={program.playback} connected={connected} clockOffset={clockOffset} onSample={reportPlayback} />
    </aside>
  </main>;
}
