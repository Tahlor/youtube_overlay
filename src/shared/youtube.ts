const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export function parseYouTubeVideoId(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  if (VIDEO_ID_RE.test(value)) return value;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  let candidate: string | null = null;

  if (host === "youtu.be") {
    candidate = url.pathname.split("/").filter(Boolean)[0] ?? null;
  } else if (host === "youtube.com" || host === "m.youtube.com") {
    if (url.pathname === "/watch") {
      candidate = url.searchParams.get("v");
    } else {
      const parts = url.pathname.split("/").filter(Boolean);
      if (["live", "embed", "shorts"].includes(parts[0] ?? "")) {
        candidate = parts[1] ?? null;
      }
    }
  }

  return candidate && VIDEO_ID_RE.test(candidate) ? candidate : null;
}

export function isYouTubeVideoId(value: string): boolean {
  return VIDEO_ID_RE.test(value);
}
