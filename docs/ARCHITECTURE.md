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
- Later: image search, Favorites, Recent.
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
- Later: host image-provider endpoints and persistence.

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
}
```

M0 can use a built-in test asset. The `Asset` shape is intentionally sufficient for later search/persistence without tying the core switcher to a particular provider.

## Socket protocol

The protocol should stay small.

### Server -> client

`program:state`

Payload: complete `ProgramState`.

Clients do not need to replay event history; receiving the newest full state is sufficient.

### Client -> server

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

Commands should support acknowledgements so the Director can show validation failures without guessing whether Program changed.

## State invariants

1. `mode === "live"` implies `activeAsset === null`.
2. `mode === "graphic"` implies `activeAsset !== null`.
3. Every accepted state mutation increments `revision` exactly once.
4. Invalid commands do not mutate state.
5. A newly connected client receives the current complete state.

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
