# Architecture

## Overview

The MVP is a browser-based program switcher, not a media rebroadcaster.

```text
Director browser                       Output browser / TV
      |                                        |
      |       Socket.IO commands/state        |
      +---------------+  +--------------------+
                      |  |
                  Archimedes
             Node/Express/Socket.IO
                      |
                canonical Program
```

Both browsers load the YouTube player directly. Archimedes coordinates only Program state and application data.

## Responsibilities

### Director

- Render its own YouTube monitor.
- Accept/set the video URL or ID.
- Hold local Preview state.
- Manual image search, Favorites and Recent.
- Emit explicit Program commands.
- Render the current canonical Program state for confidence.

### Output

- Render canonical Program state only.
- In `live` mode, show the YouTube player as the dominant view.
- In `graphic` mode, show the active graphic as dominant and retain the YouTube player visibly alongside it.
- Never invent local Program changes.

### Server

- Own canonical Program state.
- Validate commands.
- Increment Program revision on accepted changes.
- Broadcast the full Program state after each accepted change.
- Send the current Program state immediately when a client connects.
- Respond to explicit state-resync requests from already-connected clients.
- Host image-provider endpoints and SQLite persistence.

## Core domain types

```ts
export type ProgramMode = "live" | "graphic";

export interface Asset {
  id: string;
  title: string;
  fullUrl: string;
  thumbnailUrl?: string;
  source?: string;
  sourceUrl?: string;
}

export interface ProgramState {
  videoId: string | null;
  mode: ProgramMode;
  activeAsset: Asset | null;
  revision: number;
  playback: { status: "playing" | "paused"; position: number | null; updatedAt: number; revision: number };
}
```

M0 can use a built-in test asset. The `Asset` shape is intentionally sufficient for later search/persistence without tying the core switcher to a particular provider.

## Socket protocol

The protocol should stay small.

### Server -> client

`program:state`

Payload: complete `ProgramState`, followed by the current server timestamp for clock alignment.

Clients do not need to replay event history; receiving the newest full state is sufficient.

### Client -> server

`program:get-state`

No payload. The server responds to that client with the complete current `program:state`.

This explicit resync exists in addition to the server's automatic state message on connection. It prevents a fast connection from becoming a UI race: browser listeners are installed before the client starts connecting, and a client that is already connected when a component mounts can request the current state again safely.

`program:set-video`

```ts
{ videoId: string }
```

`program:take`

```ts
{ asset: Asset }
```

`program:live`

No payload.

Mutation commands support acknowledgements so the Director can show validation failures without guessing whether Program changed.

`program:playback` accepts `{ videoId, playbackRevision, action: 'play' | 'pause' | 'seek' | 'skip', position?, seconds? }`. Video and playback revision checks reject stale commands. Pause/skip prefer fresh TV timing; absolute seeking uses the requested position. Skip targets clamp to zero and the latest known duration. Layout changes preserve the independent playback revision.

`playback:report` carries bounded TV timing/status samples once per second. `playback:output` relays fresh samples to Director. Stale video/revision reports are ignored; a five-second age limit prevents old feedback from controlling the new video. The first playing TV report anchors a new stream; later samples update position without incrementing command revision, and checkpoints persist at most once every five seconds. A paused command is persisted immediately. `program:clock` acknowledges the server timestamp to estimate browser clock offset.

Players apply new playback revisions through YouTube's play/pause/seek API. They suppress native event echoes during command application, then forward native play/pause and detected scrubbing as explicit commands. Delayed readiness applies the latest state. A null initial position allows YouTube to choose the starting live edge. No regular forced seeking is used; DVR limits, keyframes and buffering remain YouTube's responsibility.

## Client connection lifecycle

The Socket.IO client is created with `autoConnect: false`.

The Program hook then:

1. installs `program:state`, `connect`, and `disconnect` listeners;
2. connects the socket only after those listeners exist;
3. requests `program:get-state` on every connection;
4. if the singleton is already connected, immediately requests state again.

This ordering is intentional. Starting the socket at module-import time can allow a sufficiently fast connection to emit both `connect` and the initial Program state before React installs its listeners, leaving a page visually stuck in its initial/reconnecting state even though the underlying socket is healthy.

## State invariants

1. `mode === "live"` implies `activeAsset === null`.
2. `mode === "graphic"` implies `activeAsset !== null`.
3. Every accepted command increments `revision` exactly once; timing checkpoints update position without a command revision.
4. Invalid commands do not mutate state.
5. A newly connected client receives the current complete state.
6. Any connected client can explicitly resync to the current complete state without mutating Program.

## Preview vs Program

Preview is deliberately not part of shared server state.

```text
Search/click -> local Preview -> TAKE -> canonical Program
```

This prevents accidental on-air changes and avoids unnecessary realtime synchronization.

## Video parsing

The client/server should accept common YouTube forms but reduce them to a validated video ID before updating Program. Expected forms include:

- `https://www.youtube.com/watch?v=VIDEO_ID`
- `https://youtu.be/VIDEO_ID`
- `https://www.youtube.com/live/VIDEO_ID`
- a bare 11-character YouTube video ID

Parsing is a small isolated utility with unit tests.

## Production shape

Development may run Vite and the server separately, but production should be one deployable Node process:

1. Build the React/Vite frontend.
2. Express serves the generated static files.
3. Express returns the SPA entry point for `/director` and `/output`.
4. The same HTTP server hosts Socket.IO.

This keeps Archimedes deployment simple and avoids CORS/configuration drift.

## Extension interfaces

### Image search

```ts
interface ImageProvider {
  search(query: string): Promise<Asset[]>;
}
```

The UI should consume normalized `Asset` objects and remain provider-agnostic.

### Future transcript/context

```ts
interface ContextProvider {
  getRecentContext(): Promise<ContextChunk | null>;
}
```

No implementation is required for MVP.

### Future AI suggestions

```ts
interface SearchSuggestionProvider {
  suggest(context: ContextChunk): Promise<string[]>;
}
```

Suggestions feed the same existing image-search layer. They never mutate Program directly.

## Failure isolation

Core Program state/switching must not depend on:

- image search availability;
- database availability;
- transcript/caption availability;
- AI services.

If any optional subsystem fails, LIVE and already-loaded core switching must continue working.

## Deliberately deferred complexity

- Continuous Director/Output playback-time synchronization.
- Media capture/transcoding.
- OBS/ffmpeg/WebRTC/HLS program output.
- Distributed/multi-session storage.
- Authentication/authorization.

These can be added only when a demonstrated need outweighs their operational cost.

## M1–M3 implementation

`WikimediaProvider` implements `ImageProvider` with Commons file search and image metadata. `/api/images/search?q=…` returns normalized assets with HTTPS thumbnails, source/creator/license attribution, bounded queries, a 10-second upstream timeout, bounded concurrency and a five-minute cache. Images load directly from Wikimedia; the server does not proxy arbitrary image URLs.

`LibraryStore` uses Node’s bundled SQLite API with WAL and parameterized statements. `/api/library` returns Favorites and Recent, and `/api/library/favorite` accepts an asset plus boolean favorite status. TAKE increments use count and last-used time; favorites do not affect Program. `library:changed` invalidates Director library data after favorite/usage changes. The same database stores a validated full Program snapshot after accepted commands, so a process restart restores video/layout/revision. A corrupt snapshot starts safely in LIVE. Startup or write failures expose degraded persistence in health and the library UI while core switching continues.

Assets are normalized and bounded at the server boundary. URL protocols are restricted to HTTPS or app-relative paths; provider markup is rendered as plain text. Invalid commands never alter Program. Acknowledgements are checked as functions before invocation. Director mutation commands expire after four seconds, resync after a missing acknowledgement, and are never queued while disconnected.

Output keeps a single YouTube iframe/player mounted across LIVE/graphic layouts. The IFrame API reports startup, playback state, errors and blocked autoplay; Start video and Retry player remain available alongside a YouTube link. Controls occupy their own area and never obscure the embedded player. Director monitoring stays muted. Player readiness does not govern Program switching.

Build metadata at `/build.json` and in `/api/healthz` identifies the source commit and frontend asset names. API and route HTML responses avoid stale caching; Vite assets carry content hashes.

References: [Commons image metadata API](https://www.mediawiki.org/wiki/API:Imageinfo), [YouTube IFrame API](https://developers.google.com/youtube/iframe_api_reference), [Node SQLite API](https://nodejs.org/api/sqlite.html).
