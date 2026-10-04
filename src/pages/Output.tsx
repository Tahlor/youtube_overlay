import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AssetImage } from '../components/AssetImage';
import { Attribution } from '../components/Attribution';
import { YouTubePlayer } from '../components/YouTubePlayer';
import { DEFAULT_PRESENTATION } from '../shared/presentation';
import type { Asset, PresentationSettings } from '../shared/types';
import { useProgram } from '../useProgram';
import '../broadcast.css';

const TRANSITION_MS = 350;

export function Output() {
  const { program, connected, clockOffset, reportPlayback } = useProgram();
  const presentation = program.presentation ?? DEFAULT_PRESENTATION;
  const graphicActive = program.mode === 'graphic' && Boolean(program.activeAsset);
  const [heldGraphic, setHeldGraphic] = useState<Asset | null>(program.activeAsset);

  // Keep the outgoing graphic for the short transition back to live video.
  useEffect(() => {
    if (graphicActive && program.activeAsset) {
      setHeldGraphic(program.activeAsset);
      return;
    }
    if (!heldGraphic) return;
    const timer = window.setTimeout(
      () => setHeldGraphic(null),
      presentation.transition === 'cut' ? 0 : TRANSITION_MS,
    );
    return () => window.clearTimeout(timer);
  }, [graphicActive, program.activeAsset?.id, program.activeAsset?.fullUrl, program.activeAsset?.title, presentation.transition]);

  const graphic = graphicActive ? program.activeAsset : heldGraphic;
  const shellClasses = [
    'output-shell',
    'broadcast-output',
    graphicActive ? 'graphic-mode' : 'live-mode',
    `layout-${presentation.layout}`,
    `transition-${presentation.transition}`,
    `corner-${presentation.corner}`,
    `size-${presentation.size}`,
    `fit-${presentation.fit}`,
  ].join(' ');

  return <main className={shellClasses} data-broadcast-output data-layout={presentation.layout} data-corner={presentation.corner}>
    {!connected && <div className="connection-ribbon" role="status">Reconnecting…</div>}

    {/* One mounted player stays in place while the image stage changes around it. */}
    <aside className="program-live-side audience-video-stage" aria-label="Live video">
      <YouTubePlayer
        videoId={program.videoId}
        title="Live program video"
        className="program-video"
        playback={program.playback}
        connected={connected}
        clockOffset={clockOffset}
        onSample={reportPlayback}
        audience
      />
    </aside>

    {/* Image-only overlays the still-running embed; YouTube's public policies prohibit obscuring an embed or using it as a background player. */}
    <section
      className={`program-graphic ${graphic ? 'has-graphic' : 'empty-graphic'} ${graphicActive ? 'is-active' : 'is-inactive'}`}
      aria-hidden={!graphicActive}
      aria-label={graphicActive ? 'On air image' : undefined}
    >
      {graphic && <div className="graphic-media">
        <TransitionImage asset={graphic} transition={presentation.transition} />
      </div>}
    </section>

    {graphicActive && program.activeAsset && <details className="audience-info">
      <summary aria-label="Image information" title="Image information">ⓘ</summary>
      <div className="audience-info-card">
        <strong>{program.activeAsset.title}</strong>
        <Attribution asset={program.activeAsset} />
      </div>
    </details>}
  </main>;
}

function TransitionImage({ asset, transition }: { asset: Asset; transition: PresentationSettings['transition'] }) {
  const previous = useRef(asset);
  const [leaving, setLeaving] = useState<Asset | null>(null);

  useLayoutEffect(() => {
    if (previous.current.fullUrl === asset.fullUrl) {
      previous.current = asset;
      return;
    }
    const outgoing = previous.current;
    previous.current = asset;
    setLeaving(outgoing);
    const timer = window.setTimeout(() => setLeaving(null), transition === 'cut' ? 0 : TRANSITION_MS);
    return () => window.clearTimeout(timer);
  }, [asset.id, asset.fullUrl, asset.title, transition]);

  return <div className="graphic-image-stack">
    <div className="graphic-image-current" key={`current-${asset.fullUrl}`}>
      <AssetImage asset={asset} />
    </div>
    {leaving && <div className={`graphic-image-leaving ${transition}`} key={`leaving-${leaving.fullUrl}`} aria-hidden="true">
      <AssetImage asset={leaving} />
    </div>}
  </div>;
}
