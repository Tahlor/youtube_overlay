import { useEffect, useRef, useState } from 'react';
interface Player { playVideo(): void; mute(): void; unMute(): void; destroy(): void }
interface API { Player: new (iframe: HTMLIFrameElement, options: { events: Record<string, (event: { data: number; target: Player }) => void> }) => Player }
declare global { interface Window { YT?: API; onYouTubeIframeAPIReady?: () => void } }
let apiPromise: Promise<API> | null = null;
function loadAPI(): Promise<API> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve,reject) => {
    const timer = window.setTimeout(() => { apiPromise = null; reject(new Error('YouTube did not load. Check the connection and retry.')); },12000);
    window.onYouTubeIframeAPIReady = () => { clearTimeout(timer); if (window.YT) resolve(window.YT); };
    document.querySelector('#youtube-api')?.remove();
    const script = document.createElement('script'); script.id='youtube-api'; script.src='https://www.youtube.com/iframe_api';
    script.onerror = () => { clearTimeout(timer); apiPromise=null; reject(new Error('YouTube is unavailable. Check the connection and retry.')); };
    document.head.appendChild(script);
  });
  return apiPromise;
}
export function YouTubePlayer({videoId,title,muted=false,className=''}: {videoId:string|null;title:string;muted?:boolean;className?:string}) {
  const container=useRef<HTMLDivElement>(null);
  const player=useRef<Player | null>(null);
  const [status,setStatus]=useState('Loading YouTube…');
  const [retry,setRetry]=useState(0);
  useEffect(() => {
    if (!videoId || !container.current) return;
    let disposed=false;
    setStatus('Loading YouTube…');
    const frame=document.createElement('iframe'); frame.title=title;
    frame.allow='autoplay; encrypted-media; picture-in-picture; fullscreen'; frame.referrerPolicy='strict-origin-when-cross-origin'; frame.allowFullscreen=true;
    const params=new URLSearchParams({autoplay:'1',playsinline:'1',rel:'0',enablejsapi:'1',origin:window.location.origin,mute:muted?'1':'0'});
    frame.src=`https://www.youtube.com/embed/${videoId}?${params}`;
    container.current.replaceChildren(frame);
    const startup=window.setTimeout(() => { if (!disposed) setStatus('Video has not started. Press Start video or retry.'); },15000);
    loadAPI().then(api => {
      if (disposed) return;
      player.current=new api.Player(frame,{events:{
        onReady: ({target}) => { if (disposed) return; if (muted) target.mute(); setStatus('Ready. Press Start video if playback is paused.'); target.playVideo(); },
        onStateChange: ({data}) => { if (disposed) return; if (data===1) { clearTimeout(startup); setStatus(muted?'Playing · monitor muted':'Playing'); } else if (data===0) setStatus('Video ended. Choose another video from Director.'); else if (data===2) setStatus('Paused. Press Start video to continue.'); },
        onAutoplayBlocked: () => { if (!disposed) { clearTimeout(startup); setStatus('Autoplay blocked. Press Start video to play with sound.'); } },
        onError: ({data}) => { if (!disposed) { clearTimeout(startup); setStatus(data===100 ? 'Video unavailable or private. Choose another video.' : data===101 || data===150 ? 'YouTube blocked embedded playback. Open YouTube or choose another video.' : `YouTube player error (${data}). Retry or open YouTube.`); } },
      }});
    }).catch(error => { if (!disposed) { clearTimeout(startup); setStatus(error.message); } });
    return () => { disposed=true; clearTimeout(startup); player.current?.destroy(); player.current=null; container.current?.replaceChildren(); };
  },[videoId,muted,title,retry]);
  if (!videoId) return <div className={`youtube-placeholder ${className}`}><div><strong>No YouTube video selected</strong><span>Set the stream from the Director console.</span></div></div>;
  return <div className={`youtube-player ${className}`}>
    <div ref={container} className="youtube-frame" />
    <div className="player-controls">
      <span role="status">{status}</span>
      <button onClick={() => { if (player.current) { if (!muted) player.current.unMute(); player.current.playVideo(); } else setRetry(value=>value+1); }}>Start video</button>
      <button onClick={() => setRetry(value=>value+1)}>Retry player</button>
      <a href={`https://www.youtube.com/watch?v=${videoId}`} target="_blank" rel="noreferrer">Open YouTube</a>
    </div>
  </div>;
}
