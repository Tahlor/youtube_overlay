# YouTube Overlay

A lightweight browser-based live-program switcher for family viewing. The initial use case is General Conference: kids act as directors from a laptop while the family watches a shared program output on a TV.

The product deliberately starts simple: both Director and Output play the original YouTube stream directly. Archimedes carries only control/state messages and, later, image-search/persistence traffic. No video transcoding or rebroadcasting is required for the MVP.

## Live deployment

The M0–M3 application is deployed on Archimedes:

- Director: `https://taylorarchibald.com/youtube_overlay/director`
- TV output: `https://taylorarchibald.com/youtube_overlay/output`
- Health: `https://taylorarchibald.com/youtube_overlay/api/healthz`

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for service, nginx, verification, and update details.

## MVP user flow

1. Open `/director` on the directing computer.
2. Open `/output` on the TV.
3. Set the YouTube live URL/video.
   Use **Pause / Play**, **−10s / +10s**, the seek bar, or the **Seek** time field to control both the monitor and TV. Time entry accepts seconds, `mm:ss`, or `hh:mm:ss`. Seeking while paused keeps both players paused.
4. Search Commons and Openverse, reuse Favorites/Recent, or paste a public HTTPS image URL into Preview. Results stream in as each source responds; use Load more for additional pages.
5. Selecting changes **Preview** only.
6. Choose Over the shoulder, Picture in picture, or Image only; set the corner, size, image fit and transition, then press **Show image · TAKE**.
7. Press **Back to video** to remove the on-air image and return to the main video layout.

The server owns canonical Program state. Preview remains local to the Director.

**Back to video** restores the video layout and preserves the current playback position and pause. Native YouTube play/pause and scrubbing also update shared playback. The Director shows recent TV playback feedback; **Start video** on the TV handles browser autoplay restrictions. Live rewind/seek depends on YouTube DVR being enabled and the available recording window. Players share transport commands; buffering and YouTube keyframes can cause small timing differences.

## Current milestones

- **M0 — end-to-end switching:** Director, Output, Socket.IO canonical state, YouTube embed, built-in test graphic, TAKE, LIVE, reconnect/state restore.
- **M1 — image search:** provider abstraction, search results, safe preview/TAKE workflow.
- **M2 — persistence:** favorites and recently used assets backed by SQLite.
- **M3 — reliability/deployment:** reconnect/error handling and verified Archimedes production deployment.
- **M4 — polish:** child-friendly UI refinements and optional broadcast-style features.

Captions, speech-to-text, AI-assisted suggestions, and a true composited/restreamed media output are explicit backlog items, not MVP dependencies.

See:

- [`docs/PRODUCT.md`](docs/PRODUCT.md)
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/ROADMAP.md`](docs/ROADMAP.md)
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)

## Architectural principles

- The core switcher must be useful with **no captions and no AI**.
- Search/persistence failures must never disable **LIVE**.
- Preview is local; Program is shared canonical server state.
- Keep one YouTube player mounted across presentation changes so switching never restarts or pauses it. See the source limitations below for covering the embed and image-only audio.
- Avoid video encoding/transcoding until a proven need justifies the complexity.
- Design small provider interfaces for future image/context/AI integrations without implementing them prematurely.

## Stack

- React + TypeScript + Vite
- Node.js + Express
- Socket.IO
- SQLite via Node’s bundled `node:sqlite` (no database daemon)

The production Node process serves both the built web app and Socket.IO/API.

## Local development

Requirements: Node.js 22.13+ (production tested on Node 24).

```bash
npm ci
npm run dev
```

Development runs Vite on port 5173 and the application server on port 3001, with Vite proxying Socket.IO/API traffic to the server.

Open:

- `http://localhost:5173/director`
- `http://localhost:5173/output`

Run all checks:

```bash
npm run check
```

That command runs client/server TypeScript validation, unit tests, and a production build.

Run `npm run test:playback` after building for the shared transport acceptance checks (pause, rewind, fast forward, pointer/keyboard scrubbing, timestamps, native controls, paused reload/restart, and TAKE/LIVE). This uses a simulated IFrame API to verify app behavior; `npm run test:browser` separately records real YouTube startup observations.

## Browser validation

After `npm run check`, run `npm run test:browser`. It starts an isolated production candidate under `/youtube_overlay`, uses Chromium, and checks real image search, safe Preview, TAKE/LIVE, reconnect, reload and SQLite recovery across a server restart. Set `CHROMIUM_PATH` if Chromium is not at `/usr/local/bin/chromium`.

To test an already deployed target:

```bash
BASE_URL=https://taylorarchibald.com/youtube_overlay EVIDENCE_DIR=/tmp/overlay-evidence npm run test:browser
```

This test changes shared Program and finishes in LIVE. Server-restart validation on an external target requires `RESTART_SERVICE=app-youtube-overlay.service` and local sudo access. Autoplay event handling is also exercised with a clearly labeled simulated API event; real YouTube observations are recorded separately. Actual playback and audible sound depend on YouTube and the viewing browser.

## MVP status

M0–M3 are implemented. Tracking issues #1–#4, #10 and #11 contain acceptance evidence and any remaining environmental limits. No captions, AI, automatic TAKE or media pipeline is required.

Search federates Wikimedia Commons and Openverse; source and license links are available in results, Preview and Output. Google Images opens as an external discovery page because Google’s Custom Search JSON API is closed to new customers; an image found elsewhere can be pasted as a public HTTPS image URL. Review an image’s source page for complete reuse terms. Favorites, usage and current Program are stored in `data/overlay.sqlite` (override with `DATA_PATH`); preserve the database and its WAL/SHM files when backing up a running service. Database/provider outages leave LIVE and loaded Program controls available.

## Broadcast console release

The Director fits the primary workflow at 1366×768 and 1440×900 with image results scrolling inside the library. Audience Output renders a full-screen broadcast stage with shoulder graphics, corner video PIP, or an image covering the video. Healthy playback shows no transport panel; moving the pointer briefly reveals output options. Fullscreen expands the whole composition. Cut, fade and slide are supported, with reduced-motion preferences respected. Presentation settings are persisted with Program and remain local staging until TAKE.

Run `npm run test:broadcast` after a build to validate desktop geometry, all three layouts, corner placement, player continuity, Back to video, streaming UI, pagination, stale-query cancellation and direct URL import. Media playback in this test is simulated; the ordinary browser suite records actual YouTube startup separately.

**YouTube source limitations:** The app keeps the existing embed running underneath graphics and never extracts audio or changes the stream source. YouTube’s [required minimum functionality](https://developers.google.com/youtube/terms/required-minimum-functionality) restricts overlays obscuring the player, and its [developer policies](https://developers.google.com/youtube/terms/developer-policies) prohibit background players. Shoulder overlays and image-only audio should not be described as policy-supported YouTube integration. Image-only audio is a best-effort visual mode, subject to browser and YouTube behavior; actual playback/audio on this host may also be blocked by YouTube’s sign-in challenge.
