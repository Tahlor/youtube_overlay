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

### Caption context and AI-assisted search

Tracking: #5.

Architectural seam only until the base product is proven:

```text
ContextProvider -> SearchSuggestionProvider -> ImageProvider
```

Potential transcript inputs (caption bridge, speech-to-text, etc.) should be evaluated later. AI may suggest searches but should never TAKE automatically.

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
