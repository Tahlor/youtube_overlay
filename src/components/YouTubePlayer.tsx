interface YouTubePlayerProps {
  videoId: string | null;
  title: string;
  muted?: boolean;
  className?: string;
}

export function YouTubePlayer({
  videoId,
  title,
  muted = false,
  className,
}: YouTubePlayerProps) {
  if (!videoId) {
    return (
      <div className={`youtube-placeholder ${className ?? ""}`}>
        <div>
          <strong>No YouTube video selected</strong>
          <span>Set the stream from the Director console.</span>
        </div>
      </div>
    );
  }

  const params = new URLSearchParams({
    autoplay: "1",
    playsinline: "1",
    rel: "0",
  });
  if (muted) params.set("mute", "1");

  return (
    <div className={`youtube-frame ${className ?? ""}`}>
      <iframe
        key={videoId}
        src={`https://www.youtube.com/embed/${videoId}?${params.toString()}`}
        title={title}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        referrerPolicy="strict-origin-when-cross-origin"
        allowFullScreen
      />
    </div>
  );
}
