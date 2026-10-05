# TV playback and audience controls: implementation issues

These are implementation-ready issue drafts. They describe the requested outcome before changing behavior. The current app serves a React `/output` page with a YouTube iframe, Socket.IO Program state, and a downloadable APK link. No Android source project is checked in as of this review. Another workstream is actively changing input switching and audio, so implementers should rebase their plans on the settled Program schema before editing shared files.

## 1. Captions that viewers can control

**Problem.** Captions appear on the downstream player, but the audience has no clear caption setting, especially when the APK hides YouTube controls and has no touchscreen. The Director also cannot tell which device is showing captions.

**Outcome.** Provide an accessible Output settings menu on TV and phone with caption preference, preferred language, and supported text size. Caption preference belongs to each viewing device; it must not unexpectedly change other screens or Program playback. Show the actual applied state or explain when YouTube does not make it observable.

**Implementation plan.**

1. Verify caption behavior on a real captioned live stream and an ordinary video in Chromium, Android WebView, and the target Superbox. Record what the embedded player exposes. Keep this separate from transcript extraction in issue #22.
2. Add per-device persisted settings with `Auto` (YouTube preference) and `Prefer on` (`cc_load_policy=1`, optional `cc_lang_pref`). The documented IFrame API exposes caption `fontSize` when its captions module is loaded. Test whether changing preference requires a player reload and, if so, preserve position and avoid duplicate audio.
3. Treat `Off` as a feasibility gate: the documented embed parameters do not provide a force-off setting. Only offer an Off control if a supported method demonstrably turns captions off on target devices. Otherwise expose YouTube's own caption menu through an accessible player-controls mode, or label Off unavailable. Do not claim a setting succeeded when it did not.
4. Make the settings menu usable with pointer, touch, Tab/Enter/Escape, and remote D-pad/OK/Back. Keep focus visible and restore it when the menu closes.

**Acceptance.** Preferences survive reload and APK restart; `Prefer on` displays an available caption track without mutating shared playback; unavailable tracks and unsupported Off state are clearly reported; switching a caption preference never silently pauses or resets the program; TV remote and phone can complete the same workflow. Verify against real YouTube behavior as well as mocked player tests.

**Likely files.** `src/components/YouTubePlayer.tsx`, `src/pages/Output.tsx`, Output CSS, a local settings module, Android project once restored.

## 2. Playback must survive tab and app navigation

**Problem.** Leaving a tab or screen can suspend a player. A background pause must never be interpreted as an operator command to pause the shared Program. Returning to Output should recover at the intended position without a manual seek when possible.

**Outcome.** Internal app tabs and settings never unmount or restart the active output player. Moving a browser tab out of focus does not change canonical Program from playing to paused. The APK keeps playback through its own navigation. If the requirement also covers leaving the APK for another Android app, verify that separately against the device and choose a supported media architecture if WebView cannot satisfy it.

**Implementation plan.**

1. Instrument player mount identity, state changes, visibility events, media time, audio continuity, and server playback revisions. Reproduce internal tab, browser tab, phone screen lock, Android Home/app switch, and network reconnect separately.
2. Keep the output media element mounted while menus/layouts change. Distinguish explicit Play/Pause actions from iframe `onStateChange`, visibility suspension, audio-focus changes, and stale reports. Only explicit authorized commands may pause shared Program.
3. On resume, compare the output player to fresh canonical state and recover once, with a bounded retry and visible status. Do not seek continuously or restart the iframe for cosmetic changes. Handle live DVR bounds and autoplay blocks.
4. Review the Android activity/WebView lifecycle. Test whether a persistent foreground media session or PiP is supported by the device and by the chosen source integration; do not assume WebView audio can continue when the OS stops the activity. If real YouTube playback cannot satisfy background operation, document and implement an approved source/player path that can, before marking this issue done.

**Acceptance.** Repeated switching among app tabs/settings/layouts leaves iframe identity, position progression, and audio uninterrupted; browser background/foreground does not emit a shared pause; explicit Pause still pauses; recoverable suspension resumes at the correct live/recorded position; actual Superbox and phone tests report the result for Android app switching. Simulated IFrame tests alone are insufficient for the final guarantee.

**Likely files.** `src/components/YouTubePlayer.tsx`, `src/pages/Output.tsx`, `src/useProgram.ts`, `server/index.ts`, Android lifecycle code, `tests/playback-browser.mjs`.

## 3. Slow image pan and zoom

**Problem.** A full-screen graphic is static. The Director needs controlled, very slow motion such as a gradual zoom in, zoom out, or pan across a photo.

**Outcome.** Preview and Program share a motion setting per TAKE: `None`, `Slow zoom in`, `Slow zoom out`, and `Pan`, with an adjustable duration and start/end crop. Motion affects only the image, never the video player or captions.

**Implementation plan.**

1. Extend `PresentationSettings` with validated optional motion data and a migration default of `None`; clamp scale, pan, and duration to safe values. Keep Preview staging local until TAKE.
2. Render the motion on a composited image layer using transform animation. Set a stable start time on TAKE so unrelated state reports do not reset the motion. Define behavior for a second TAKE, Back to video, image-load failure, `contain` versus `cover`, and a layout change.
3. Show start/end framing in Director Preview; provide keyboard-accessible controls and a simple preset path for a remote user. Respect `prefers-reduced-motion` by showing the static initial frame.

**Acceptance.** A 60-second zoom progresses smoothly without jitter or a player remount; Preview framing matches Output at TV and phone sizes; reconnect/reload restores the intended image and motion state; invalid motion settings are rejected; reduced-motion devices see a still image. Use deterministic transform checks plus visual checks on real screens.

**Likely files.** `src/shared/types.ts`, `src/shared/presentation.ts`, `server/programState.ts`, `src/pages/Director.tsx`, `src/pages/Output.tsx`, `src/broadcast.css`, presentation and browser tests.

## 4. Show how many are watching

**Problem.** Socket connections and the YouTube stream's public audience are different metrics. A TV can have several people in front of it, and a Director or inactive tab is not an active viewer.

**Outcome.** Show two clearly labeled values in Director: **Active output screens** and, when available, **YouTube live concurrent viewers**. Optionally let an output device declare its local group size to estimate **People at our screens**. Never call connected screens a count of people.

**Implementation plan.**

1. Add output-only presence heartbeats with a per-device session ID, current source/video ID, visibility/playback status, and a short expiry. Deduplicate reconnects and multiple sockets from one output page. Exclude Director/Preview/phone camera senders. Do not expose device identifiers to other viewers.
2. Broadcast a bounded presence summary to Director. Display unknown/stale instead of zero when the server cannot establish playback health. Keep presence out of persistent Program state so heartbeats do not create revisions or writes.
3. If YouTube totals are wanted, fetch `videos.list(part=liveStreamingDetails)` server-side for the selected video with caching, quota/rate limits, and a secret API key. The field may be absent when the stream is not live or the count is hidden. Label its update time and never merge it with app screens.
4. If group size is included, make it an opt-in per-device number with expiry and clear scope; otherwise omit the people estimate.

**Acceptance.** Two healthy Output devices show two screens; Director and duplicate reconnects do not inflate the count; disconnected/stalled devices expire; changing video does not carry old counts; absent YouTube data reads `Unavailable`, not `0`; no API key reaches the browser. Verify with multi-client server tests and one live Output smoke test.

**Likely files.** `server/index.ts`, a presence module, `src/useProgram.ts`, `src/pages/Director.tsx`, server/browser tests.

## 5. Remote-first APK and phone controls

**Problem.** The current audience toolbar appears on pointer movement and the player is configured with hidden controls and disabled YouTube keyboard handling. A Superbox remote may have no pointer; a phone needs the same actions at touch sizes. The Android source required to rebuild the downloadable APK is not present in this repository.

**Outcome.** Every essential Output action is reachable with D-pad/OK/Back, keyboard, and touch: open/close settings, caption preference, Start/Retry, fullscreen, and return to the video. Provide visible focus and a predictable Back destination. Build the APK reproducibly from checked-in source and test on Superbox and a phone.

**Implementation plan.**

1. Recover the APK source project or create a small documented Android shell for `/output`; record package ID, supported Android versions, launch mode, signing/release process, and target WebView capabilities. Do not rely on a binary-only artifact.
2. Add a remote-triggered settings button/entry point and focus trap/restore. Use large focusable controls, safe-area/overscan spacing on TV, responsive touch sizing on phone, and a non-pointer path to autoplay recovery.
3. Wire Android key events only where WebView does not deliver normal DOM navigation. Keep media keys and Back behavior explicit; do not hijack D-pad navigation for seek while a menu is open.
4. Build and install on an Android TV emulator, the target Superbox, and a phone. Capture the full remote-only path and one-handed touch path. Publish the rebuilt APK only after source/build and playback checks pass.

**Acceptance.** A user can install, launch, start video, change settings, recover playback, and leave/return using only the Superbox remote; all controls are reachable and visibly focused; phone layout has no clipped controls; the APK is reproducible from repository source; a fresh install and upgrade preserve intended local preferences.

**Likely files.** New Android project, `src/components/YouTubePlayer.tsx`, `src/pages/Output.tsx`, `src/broadcast.css`, APK build/release documentation.

## Agent handoff and integration order

1. **Coordinator:** Freeze the current input/audio workstream and shared Program schema, establish real Superbox model/Android version and APK source provenance, and own integration of shared files. Track the hard background-playback requirement as a release gate.
2. **Playback agent:** Own issue 2 and its real-device evidence. Start first because it determines whether the WebView/YouTube approach can meet the hard requirement.
3. **Android/TV agent:** Own issue 5 and the Android side of issues 1 and 2. First deliver a reproducible APK project and a remote navigation test path.
4. **Presentation agent:** Own issue 3 and its state migration. Coordinate edits to Output and Director through the coordinator so they do not collide with player work.
5. **Presence agent:** Own issue 4, primarily server protocol and tests. Add Director UI after the shared layout stabilizes.
6. **Caption agent:** Run issue 1's real-player feasibility matrix before promising Off, then implement the supported UI with the Android/TV agent.

Integrate each issue behind small, independently testable changes. The final release gate is a production build, automated state/browser tests, real YouTube observation, Superbox remote-only run, phone touch run, and live-service verification. Do not treat a mock IFrame or socket connection count as proof of real playback or real people watching.

## API and platform references

- YouTube embed caption parameters: https://developers.google.com/youtube/player_parameters
- YouTube IFrame captions API: https://developers.google.com/youtube/iframe_api_reference
- YouTube `concurrentViewers`: https://developers.google.com/youtube/v3/docs/videos/
- Android TV focus: https://developer.android.com/design/ui/tv/guides/styles/focus-system
- Android PiP and lifecycle: https://developer.android.com/develop/ui/views/picture-in-picture
