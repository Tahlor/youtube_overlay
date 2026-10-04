import { useEffect, useRef, useState } from 'react';
import type { OutputPlayback, PlaybackCommand, PlaybackSample, PlaybackState } from '../shared/types';
import { formatTime, isVideoTime, parseTime, playbackPosition } from '../shared/playback';
import { sendCommand } from '../commands';

interface Player {
  playVideo(): void; pauseVideo(): void; seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number; getDuration(): number; getPlayerState(): number;
  mute(): void; unMute(): void; destroy(): void;
}
interface API { Player: new (iframe: HTMLIFrameElement, options: { events: Record<string, (event: { data: number; target: Player }) => void> }) => Player }
declare global { interface Window { YT?: API; onYouTubeIframeAPIReady?: () => void } }
let apiPromise: Promise<API> | null = null;
function loadAPI(): Promise<API> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => { apiPromise = null; reject(new Error('YouTube did not load. Check the connection and retry.')); }, 12000);
    window.onYouTubeIframeAPIReady = () => { clearTimeout(timer); if (window.YT) resolve(window.YT); };
    document.querySelector('#youtube-api')?.remove();
    const script = document.createElement('script'); script.id = 'youtube-api'; script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = () => { clearTimeout(timer); apiPromise = null; reject(new Error('YouTube is unavailable. Check the connection and retry.')); };
    document.head.appendChild(script);
  });
  return apiPromise;
}

interface Props {
  videoId: string | null; title: string; muted?: boolean; className?: string;
  playback: PlaybackState; connected: boolean; clockOffset: number;
  outputPlayback?: OutputPlayback | null; onSample?: (sample: PlaybackSample) => void;
}
export function YouTubePlayer({ videoId, title, muted = false, className = '', playback, connected, clockOffset, outputPlayback, onSample }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const player = useRef<Player | null>(null);
  const readyRef = useRef(false);
  const appliedRevision = useRef(-1);
  const ignoreNativeUntil = useRef(0);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState('Loading YouTube…');
  const [retry, setRetry] = useState(0);
  const [sample, setSample] = useState<PlaybackSample | null>(null);
  const [seekDraft, setSeekDraft] = useState<number | null>(null);
  const [timeInput, setTimeInput] = useState('');
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef({ videoId, playback, connected, clockOffset, onSample, status });
  latest.current = { videoId, playback, connected, clockOffset, onSample, status };

  function applyPlayback(target: Player) {
    const { playback: next, clockOffset: offset } = latest.current;
    ignoreNativeUntil.current = Date.now() + 2000;
    appliedRevision.current = next.revision;
    const position = playbackPosition(next, Date.now() + offset);
    // Pause before and after seeking, including a newly cued player.
    if (next.status === 'paused') target.pauseVideo();
    if (position !== null) target.seekTo(Math.min(position, target.getDuration() || position), true);
    if (next.status === 'paused') target.pauseVideo(); else target.playVideo();
  }

  async function control(action: PlaybackCommand['action'], values: { position?: number; seconds?: number } = {}) {
    const current = latest.current;
    if (!current.videoId || pendingRef.current) return;
    pendingRef.current = true; setPending(true); setError(null);
    try {
      const position = readyRef.current ? player.current?.getCurrentTime() : undefined;
      await sendCommand('program:playback', { videoId: current.videoId, playbackRevision: current.playback.revision, action, ...(isVideoTime(position) ? { position } : {}), ...values });
    } catch (failure) { setError((failure as Error).message); }
    finally { pendingRef.current = false; setPending(false); }
  }
  const controlRef = useRef(control); controlRef.current = control;

  useEffect(() => {
    readyRef.current = false; setReady(false); setSample(null); setSeekDraft(null); setError(null);
    appliedRevision.current = -1;
    if (!videoId || !container.current) return;
    let disposed = false;
    let lastSample: { time: number; at: number; state: number } | null = null;
    let lastReport = 0;
    setStatus('Loading YouTube…');
    const frame = document.createElement('iframe'); frame.title = title;
    frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen'; frame.referrerPolicy = 'strict-origin-when-cross-origin'; frame.allowFullscreen = true;
    const params = new URLSearchParams({ autoplay: latest.current.playback.status === 'paused' ? '0' : '1', playsinline: '1', rel: '0', enablejsapi: '1', origin: window.location.origin, mute: muted ? '1' : '0' });
    frame.src = `https://www.youtube.com/embed/${videoId}?${params}`;
    container.current.replaceChildren(frame);
    const startup = window.setTimeout(() => { if (!disposed && latest.current.playback.status === 'playing') setStatus('Video has not started. Press Start video or retry.'); }, 15000);
    loadAPI().then(api => {
      if (disposed) return;
      player.current = new api.Player(frame, { events: {
        onReady: ({ target }) => {
          if (disposed) return;
          readyRef.current = true; setReady(true);
          if (muted) target.mute();
          setStatus('Ready. Press Start video if playback is paused.');
          applyPlayback(target);
        },
        onStateChange: ({ data, target }) => {
          if (disposed) return;
          if (data === 1) { clearTimeout(startup); setStatus(muted ? 'Playing · monitor muted' : 'Playing'); }
          else if (data === 0) setStatus('Video ended. Seek backward to replay or choose another video.');
          else if (data === 2) { clearTimeout(startup); setStatus('Paused'); }
          else if (data === 3) setStatus('Buffering…');
          // Native YouTube play/pause also controls the shared Program. Ignore echoes of our own commands.
          if (Date.now() > ignoreNativeUntil.current && latest.current.connected && readyRef.current) {
            if (data === 2 && latest.current.playback.status === 'playing') void controlRef.current('pause');
            if (data === 1 && latest.current.playback.status === 'paused') void controlRef.current('play');
          } else if (data === 1 && latest.current.playback.status === 'paused') target.pauseVideo();
        },
        onAutoplayBlocked: () => { if (!disposed) { clearTimeout(startup); setStatus('Autoplay blocked. Press Start video to play with sound.'); } },
        onError: ({ data }) => {
          if (!disposed) { clearTimeout(startup); setStatus(data === 100 ? 'Video unavailable or private. Choose another video.' : data === 101 || data === 150 ? 'YouTube blocked embedded playback. Open YouTube or choose another video.' : `YouTube player error (${data}). Retry or open YouTube.`); }
        },
      } });
    }).catch(failure => { if (!disposed) { clearTimeout(startup); setStatus(failure.message); } });
    const poll = window.setInterval(() => {
      const target = player.current;
      if (disposed || !target || !readyRef.current) return;
      const time = target.getCurrentTime();
      const duration = target.getDuration();
      const state = target.getPlayerState();
      if (!isVideoTime(time) || !isVideoTime(duration)) return;
      const now = Date.now();
      const next: PlaybackSample = { videoId, playbackRevision: latest.current.playback.revision, currentTime: time, duration, playerState: state, status: latest.current.status };
      setSample(next);
      // Detect native scrubbing; buffering and commanded seeks must not generate new commands.
      if (lastSample && state === lastSample.state && (state === 1 || state === 2) && now > ignoreNativeUntil.current && latest.current.connected) {
        const expected = lastSample.time + (state === 1 ? (now - lastSample.at) / 1000 : 0);
        if (Math.abs(time - expected) > 4) void controlRef.current('seek', { position: time });
      }
      lastSample = { time, at: now, state };
      if (now - lastReport >= 1000 && now > ignoreNativeUntil.current) { lastReport = now; latest.current.onSample?.(next); }
    }, 500);
    return () => {
      disposed = true; readyRef.current = false; clearTimeout(startup); clearInterval(poll);
      player.current?.destroy(); player.current = null; container.current?.replaceChildren();
    };
  }, [videoId, muted, title, retry]);

  useEffect(() => {
    if (readyRef.current && player.current && appliedRevision.current !== playback.revision) applyPlayback(player.current);
  }, [playback, clockOffset]);

  if (!videoId) return <div className={`youtube-placeholder ${className}`}><div><strong>No YouTube video selected</strong><span>Set the stream from the Director console.</span></div></div>;
  const freshOutput = outputPlayback?.videoId === videoId && outputPlayback.playbackRevision === playback.revision && Date.now() + clockOffset - outputPlayback.receivedAt < 5000 ? outputPlayback : null;
  const localSample = sample?.videoId === videoId ? sample : null;
  const timeline = freshOutput ?? (localSample?.playbackRevision === playback.revision ? localSample : null);
  const duration = freshOutput?.duration ?? localSample?.duration ?? 0;
  const position = timeline?.currentTime ?? playbackPosition(playback, Date.now() + clockOffset) ?? 0;
  const disabled = !connected || pending;
  const canSeek = !disabled && duration > 0;
  function commitSeek() { if (seekDraft !== null) { void control('seek', { position: seekDraft }); setSeekDraft(null); } }
  return <div className={`youtube-player ${className}`}>
    <div ref={container} className="youtube-frame" />
    <div className="transport-controls" aria-label="Shared video playback">
      <div className="transport-buttons">
        <button disabled={!canSeek} onClick={() => void control('skip', { seconds: -10 })} aria-label="Rewind 10 seconds">⏪ −10s</button>
        <button className="play-pause" disabled={disabled || (playback.status === 'playing' && !duration)} onClick={() => void control(playback.status === 'playing' ? 'pause' : 'play')}>
          {playback.status === 'paused' ? '▶ Play' : 'Ⅱ Pause'}
        </button>
        <button disabled={!canSeek} onClick={() => void control('skip', { seconds: 10 })} aria-label="Fast forward 10 seconds">+10s ⏩</button>
        <span className="playback-time">{formatTime(seekDraft ?? position)} / {duration ? formatTime(duration) : '—'}</span>
      </div>
      <input className="seek-slider" type="range" aria-label="Seek video" aria-valuetext={formatTime(seekDraft ?? position)} min="0" max={duration || 1} step="1" value={Math.min(duration || 1, seekDraft ?? position)} disabled={!canSeek}
        onChange={event => setSeekDraft(Number(event.target.value))} onPointerUp={commitSeek} onPointerCancel={() => setSeekDraft(null)}
        onKeyUp={event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) commitSeek(); }} onBlur={commitSeek} />
      <form className="seek-form" onSubmit={event => {
        event.preventDefault(); const seconds = parseTime(timeInput);
        if (seconds === null) setError('Enter seconds, mm:ss, or hh:mm:ss.');
        else if (duration && seconds > duration) setError('That time is beyond the available video.');
        else void control('seek', { position: seconds });
      }}>
        <input aria-label="Seek to time" placeholder="mm:ss or hh:mm:ss" value={timeInput} onChange={event => setTimeInput(event.target.value)} disabled={!canSeek} />
        <button type="submit" disabled={!canSeek}>Seek</button>
        <span>{pending ? 'Sending…' : playback.status === 'paused' ? 'Program paused' : 'Program playing'}</span>
      </form>
      {muted && <p className="transport-note">Playback controls change the TV too. {freshOutput ? `TV: ${freshOutput.status}` : 'TV playback not confirmed.'}</p>}
      {duration === 0 && <p className="transport-note">Waiting for YouTube timing. Live rewind and seeking require DVR on the stream.</p>}
      {error && <p className="error-message" role="alert">{error}</p>}
    </div>
    <div className="player-controls">
      <span role="status">{status}</span>
      <button onClick={() => {
        if (player.current && ready) {
          if (!muted) player.current.unMute();
          if (latest.current.playback.status === 'paused') void control('play'); else applyPlayback(player.current);
        } else setRetry(value => value + 1);
      }}>Start video</button>
      <button onClick={() => setRetry(value => value + 1)}>Retry player</button>
      <a href={`https://www.youtube.com/watch?v=${videoId}`} target="_blank" rel="noreferrer">Open YouTube</a>
    </div>
  </div>;
}
