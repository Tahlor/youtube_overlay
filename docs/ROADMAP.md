# Roadmap

The roadmap is ordered to get a usable household experience running as early as possible. Later milestones must not be allowed to destabilize the core LIVE/TAKE loop.

## M0 — Make the TV change

Tracking: #1, test plan #10.

Deliver the smallest complete vertical slice:

- React/Vite application with `/director` and `/output`.
- Node/Express/Socket.IO server.
- Server-owned canonical Program state.
- YouTube URL/ID parsing.
- Built-in test graphic.
- Local Preview.
- TAKE and LIVE commands.
- Full Program state sent on connect and after every accepted mutation.
- Basic automated tests for parsing/state invariants.
- Production build shape suitable for Archimedes.

Exit criterion: a laptop can reliably change the TV between LIVE and the built-in graphic layout.

## M1 — Make it fun

Tracking: #2.

- Add `ImageProvider` abstraction.
- Implement one low-friction image source.
- Search UI/result grid.
- Search result -> Preview only.
- Preview -> TAKE -> Program.
- Provider errors isolated from core controls.

Exit criterion: a child can independently find a relevant image and put it on Program.

## M2 — Make it reusable

Tracking: #3.

- SQLite persistence.
- Favorites.
- Recently used assets.
- Usage counts/timestamps/source metadata.

Exit criterion: useful assets are easy to reuse and survive restart.

## M3 — Make it Conference-proof

Tracking: #4 and #11.

- Reconnect/recovery behavior.
- YouTube startup/autoplay handling.
- Clear connection/error states.
- Responsive/touch usability pass.
- Production Archimedes service integration.
- Restart/reboot/rollback verification.

Exit criterion: ordinary browser/network/process disruptions recover without turning the event into a server-maintenance session.

## M4 — Make it nice

Tracking: #9.

Only after M0–M3 are dependable:

- Broadcast-style visual polish.
- Optional transitions.
- Larger child-friendly controls.
- Quick topic buttons.
- Mobile refinements.

## Backlog — intentionally not on the critical path

### Output Recording
Tracking: #16.
- Evaluate client-side recording via `MediaRecorder` / `canvas.captureStream()` on `/output`.
- Server-side headless compositing (Chromium/Puppeteer or FFmpeg) for production MP4/WebM archives.

### Freeform Layout & Arbitrary Positioning
Tracking: #17.
- Allow users to freely drag and resize video and image boxes beyond preset corners.
- Coordinate-based `PresentationSettings` with snap-to-edge guidelines.

### Centralized Controls, Shortcuts & Tooltips
Tracking: #18.
- Single unified master switcher dock for all primary switching actions.
- Keyboard shortcuts (`Enter` to TAKE, `Esc` for Back to video, `Space` for play/pause, `L` for live head).
- Contextual tooltips explaining operations and shortcut accelerators.

### Image Intake & Asset Library Expansion
Tracking: #19, #20.
- Automatic library persistence for custom entered image URLs (#19).
- Clipboard image pasting (`Ctrl+V`) directly into the library and preview (#20).

### Stream Synchronization Hardening & Force Sync
Tracking: #21.
- Active drift telemetry comparing Director monitor and TV output.
- Auto-recovery loop and dedicated "Force Sync" button on console.

### Caption context and AI-assisted search
Tracking: #5, #22.

Architectural seam only until the base product is proven:

```text
ContextProvider -> SearchSuggestionProvider -> ImageProvider
```

First step: Technical spike on YouTube live stream caption extraction feasibility (API/TimedText vs. headless demuxing vs. real-time audio STT like Whisper/Gemini). AI may suggest searches but should never TAKE automatically.

### Additional controls/layouts
Tracking: #6.

- Phone emergency remote.
- Multi-director presence.
- Search history.
- More image providers.
- More Program layouts.

### True composited/restreamed output
Tracking: #7.

Do not build a media pipeline unless browser-based Program output proves insufficient. If revisited, evaluate the requirement first and choose the media technology then rather than constraining M0 around OBS/ffmpeg/WebRTC/HLS prematurely.
