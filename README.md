# YouTube Overlay

A lightweight browser-based live-program switcher for family viewing. The initial use case is General Conference: kids act as directors from a laptop while the family watches a shared program output on a TV.

The product deliberately starts simple: both Director and Output play the original YouTube stream directly. Archimedes carries only control/state messages and, later, image-search/persistence traffic. No video transcoding or rebroadcasting is required for the MVP.

## Live deployment

The M0 application is deployed on Archimedes:

- Director: `https://taylorarchibald.com/youtube_overlay/director`
- TV output: `https://taylorarchibald.com/youtube_overlay/output`
- Health: `https://taylorarchibald.com/youtube_overlay/api/healthz`

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for service, nginx, verification, and update details.

## MVP user flow

1. Open `/director` on the directing computer.
2. Open `/output` on the TV.
3. Set the YouTube live URL/video.
4. Search/select an image (M1; M0 uses a built-in test graphic).
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
- SQLite planned for M2

The production Node process serves both the built web app and Socket.IO/API.

## Local development

Requirements: Node.js 22+.

```bash
npm install
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

## Development status

M0 is deployed and infrastructure/state-flow verified. Issue #1 tracks final M0 acceptance; issue #2 is the next product milestone for image search.
