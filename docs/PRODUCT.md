# Product Specification

## Product idea

YouTube Overlay turns children into live-program directors while the family watches a YouTube event on a TV. The director computer controls a shared Program state hosted on Archimedes. The TV displays that Program state.

The first target is General Conference, but the core product is intentionally generic enough for any YouTube livestream or video.

## Primary users

### Director
Usually a child using a laptop/desktop. The Director should be able to experiment safely without changing the TV until pressing **TAKE**.

### Audience
Family members watching `/output` on a TV or TV-connected browser.

### Parent/operator
Needs a system that starts simply, survives ordinary browser/network hiccups, and always has an obvious way back to LIVE.

## Core UX model

There are two distinct concepts:

- **Preview** — local to one Director browser. Searching/clicking assets changes only Preview.
- **Program** — canonical shared state held by the server. The TV renders Program.

Only explicit commands change Program.

### Core commands

- **SET VIDEO** — choose the YouTube stream/video.
- **TAKE** — promote the selected Preview asset to Program.
- **LIVE** — return Program to the live-video layout.

LIVE is the safety action and should remain obvious and available even if optional subsystems fail.

## Program layouts

### Live
The YouTube player is the dominant/full output view.

### Graphic
A selected graphic becomes dominant while the YouTube player remains visible in a side/PIP region. The embedded player is not covered by a custom overlay.

We may revisit true compositing/rebroadcasting later, but it is not required for the browser-switcher MVP.

## MVP requirements

### M0 — switching vertical slice

- Director and Output routes.
- YouTube video selection.
- Same selected video appears on Output.
- Built-in test asset for Preview.
- TAKE switches Output to Graphic mode.
- LIVE restores Live mode.
- Shared Program state restores after browser reload/reconnect.
- Invalid commands/input are rejected without crashing the process.

### M1 — image search

- Search field and results grid.
- One initial image provider behind an interface.
- Selecting a result affects Preview only.
- TAKE sends the selected asset to Program.
- Search failure cannot break Program controls.

### M2 — reuse

- Favorite/unfavorite assets.
- Recently used assets.
- Persistence survives server restart.

### M3 — reliability/deployment

- Reconnect/error states.
- Graceful YouTube startup/autoplay handling.
- Production build served by the Node process.
- Verified Archimedes service/reverse-proxy integration.

## Explicit non-goals for MVP

- Reading YouTube captions.
- Speech-to-text.
- LLM dependency.
- AI-selected graphics.
- Automatic TAKE.
- Frame-accurate synchronization between Director and Output YouTube players.
- Video capture/transcoding/restreaming.
- Multi-user permissions/roles.

## Future feature seams

Potential future context flow:

```text
ContextProvider -> SearchSuggestionProvider -> ImageProvider
```

This makes AI-assisted search additive: it proposes search terms/results but does not replace manual search or the Preview/TAKE workflow.

Potential polish includes quick topic buttons, transitions, a phone emergency remote, multi-director presence, and additional layouts.

## Product principles

1. **Useful without AI.** The base experience should already be fun.
2. **Safe experimentation.** Nothing goes to Program by accident.
3. **LIVE always works.** Optional features cannot block core switching.
4. **Few moving pieces.** Avoid a media pipeline until we know we need one.
5. **Kid-readable UI.** Large obvious controls beat dense professional-broadcast complexity.
6. **Recoverable.** Refreshing pages should not destroy the current Program state.
