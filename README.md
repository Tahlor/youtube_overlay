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
4. Search Wikimedia Commons or reuse Favorites/Recent; select an image into Preview.
5. Selecting changes **Preview** only.
6. Press **TAKE** to change Program.
7. Press **LIVE** at any time to return Program to the live-video layout.

The server owns canonical Program state. Preview remains local to the Director.

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
- Keep YouTube video visible in graphic mode rather than drawing custom graphics over or obscuring the embedded player.
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

## Browser validation

After `npm run check`, run `npm run test:browser`. It starts an isolated production candidate under `/youtube_overlay`, uses Chromium, and checks real image search, safe Preview, TAKE/LIVE, reconnect, reload and SQLite recovery across a server restart. Set `CHROMIUM_PATH` if Chromium is not at `/usr/local/bin/chromium`.

To test an already deployed target:

```bash
BASE_URL=https://taylorarchibald.com/youtube_overlay EVIDENCE_DIR=/tmp/overlay-evidence npm run test:browser
```

This test changes shared Program and finishes in LIVE. Server-restart validation on an external target requires `RESTART_SERVICE=app-youtube-overlay.service` and local sudo access. Autoplay event handling is also exercised with a clearly labeled simulated API event; real YouTube observations are recorded separately. Actual playback and audible sound depend on YouTube and the viewing browser.

## MVP status

M0–M3 are implemented. Tracking issues #1–#4, #10 and #11 contain acceptance evidence and any remaining environmental limits. No captions, AI, automatic TAKE or media pipeline is required.

Search uses Wikimedia Commons; credits and license links are shown in Preview and Output. Review an image’s source page for complete reuse terms. Favorites, usage and current Program are stored in `data/overlay.sqlite` (override with `DATA_PATH`); preserve the database and its WAL/SHM files when backing up a running service. Database/provider outages leave LIVE and loaded Program controls available.
