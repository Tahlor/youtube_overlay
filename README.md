# YouTube Overlay

A lightweight browser-based live-program switcher for family viewing. The initial use case is General Conference: kids act as directors from a laptop while the family watches a shared program output on a TV.

The product deliberately starts simple: both Director and Output play the original YouTube stream directly. Archimedes carries only control/state messages and, later, image-search/persistence traffic. No video transcoding or rebroadcasting is required for the MVP.

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

## Architectural principles

- The core switcher must be useful with **no captions and no AI**.
- Search/persistence failures must never disable **LIVE**.
- Preview is local; Program is shared canonical server state.
- Keep YouTube video visible in graphic mode rather than drawing custom graphics over or obscuring the embedded player.
- Avoid video encoding/transcoding until a proven need justifies the complexity.
- Design small provider interfaces for future image/context/AI integrations without implementing them prematurely.

## Planned stack

- React + TypeScript + Vite
- Node.js + Express
- Socket.IO
- SQLite in M2

For M0 the production Node process will serve both the built web app and Socket.IO/API, allowing a simple Archimedes deployment.

## Development status

Implementation is tracked in GitHub issues. Issue #1 is the active M0 vertical slice; issue #10 contains its acceptance sequence.
