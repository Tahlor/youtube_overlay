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
- **SHOW IMAGE · TAKE** — promote the selected Preview asset and staged presentation to Program.
- **BACK TO VIDEO** — remove the taken graphic and return Program to the main video layout; the underlying socket command remains `program:live`.
- **PAUSE / PLAY** — pause or resume shared playback on the monitor and TV.
- **REWIND / FAST FORWARD** — skip backward or forward ten seconds.
- **SEEK** — choose a time with the scrubber or seconds, `mm:ss`, or `hh:mm:ss` entry. Seeking while paused preserves pause.

Playback and layout are independent: TAKE and LIVE preserve playback. Shared playback commands and the paused position survive reconnect/reload/restart. Native YouTube transport interactions also send shared commands. The TV reports recent timing and player status to Director; command acknowledgement confirms server acceptance, while TV feedback indicates whether the player is running. Live seeking depends on the stream's DVR window. Browser autoplay restrictions may require pressing Start video on the TV.

Back to video is the clear safety action and remains independent of image search and persistence. Pause and playback position are preserved when removing a graphic.

## Program layouts

### Live
The YouTube player is the dominant/full output view.

### Graphic
The Director stages one of three presentations before TAKE:

- **Over the shoulder:** full-frame video with a graphic in the chosen corner.
- **Picture in picture:** full-frame graphic with the same video player inset in the chosen corner.
- **Image only:** full-frame graphic covering the still-playing video; the app does not mute or pause the player.

Four corner choices, three sizes, contain/cover image fit, and cut/fade/slide transitions are supported. The audience sees a clean stage, with player recovery appearing only when needed. Fullscreen expands the composed stage.

YouTube restricts obscuring embedded players and prohibits background players. The requested covering layouts are implemented as browser composition, but image-only audio is best effort and cannot be represented as policy-supported YouTube behavior. A controlled media source would be needed to guarantee unrestricted broadcast composition.

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
- Commons and Openverse behind a shared interface, with streamed provider batches, pagination, deduplication, cancellation and partial failure handling. Google Images discovery and public HTTPS image import are available.
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

The compact desktop console keeps source playback, image search, staged composition and switching within one screen at 1366×768 and 1440×900; results scroll inside the library. Selecting presentation settings is local Preview work and playback commands must not discard staged choices.
