import assert from "node:assert/strict";
import test from "node:test";
import { ProgramStore } from "../server/programState.js";
import type { Asset } from "../src/shared/types.js";
import { DEFAULT_PRESENTATION } from "../src/shared/presentation.js";
import { defaultAudio } from "../src/shared/input.js";

const asset: Asset = {
  id: "test",
  title: "Test graphic",
  fullUrl: "/test-graphic.svg",
};

test("starts in a safe main scene", () => {
  const store = new ProgramStore();
  assert.deepEqual(store.getState(), {
    videoId: null,
    source: 'youtube',
    audio: defaultAudio(),
    scene: { kind: 'main' },
    mode: "live",
    activeAsset: null,
    revision: 0,
    playback: { status: "playing", position: null, updatedAt: 0, revision: 0 },
    presentation: DEFAULT_PRESENTATION,
  });
});

test('camera switching preserves the YouTube position and returns to it', () => {
  const store = new ProgramStore();
  store.setVideo('dQw4w9WgXcQ');
  store.setSource('phone1', 92);
  assert.equal(store.getState().playback.position, 92);
  assert.equal(store.getState().videoId, 'dQw4w9WgXcQ');
  assert.throws(() => store.controlPlayback({ videoId: 'dQw4w9WgXcQ', playbackRevision: store.getState().playback.revision, action: 'pause' }), /Camera inputs are live/);
  store.setSource('youtube');
  assert.equal(store.getState().playback.position, 92);
  assert.equal(store.getState().source, 'youtube');
});

test('audio follows selected input by default and rejects hidden YouTube audio', () => {
  const store = new ProgramStore();
  assert.equal(store.getState().audio.followSelected, true);
  store.setSource('phone1');
  store.setAudio({ source: 'phone1', volume: 35, muted: true });
  assert.deepEqual(store.getState().audio.levels.phone1, { volume: 35, muted: true });
  assert.throws(() => store.setAudio({ followSelected: false, audioSource: 'youtube' }), /YouTube audio requires/);
  store.setAudio({ followSelected: false, audioSource: 'phone2' });
  assert.equal(store.getState().audio.source, 'phone2');
  assert.throws(() => store.setAudio({ source: 'phone1', volume: 101 }), /Volume/);
  store.setSource('phone2');
  store.setSource('youtube');
  assert.equal(store.getState().audio.followSelected, false);
  store.setSource('phone2');
  store.fallbackToYouTube('phone2');
  assert.equal(store.getState().audio.followSelected, true);
});

test("accepted image TAKE creates one canonical scene and preserves legacy compatibility", () => {
  const store = new ProgramStore();
  assert.equal(store.setVideo("dQw4w9WgXcQ").revision, 1);

  const graphic = store.take(asset, undefined, 1);
  assert.equal(graphic.revision, 2);
  assert.equal(graphic.mode, "graphic");
  assert.deepEqual(graphic.activeAsset, asset);
  assert.deepEqual(graphic.scene, { kind: 'image', asset, presentation: DEFAULT_PRESENTATION });

  const live = store.goLive(2);
  assert.equal(live.revision, 3);
  assert.equal(live.mode, "live");
  assert.equal(live.activeAsset, null);
  assert.deepEqual(live.scene, { kind: 'main' });
});

test('stale revision cannot TAKE or return over a newer Program', () => {
  const store = new ProgramStore();
  store.setVideo('dQw4w9WgXcQ');
  const stagedRevision = store.getState().revision;
  store.setVideo('aqz-KE-bpKQ');
  const before = store.getState();
  assert.throws(() => store.take(asset, undefined, stagedRevision), /Program changed/);
  assert.throws(() => store.goLive(stagedRevision), /Program changed/);
  assert.deepEqual(store.getState(), before);
});

test("rejects invalid video IDs without mutating state", () => {
  const store = new ProgramStore();
  assert.throws(() => store.setVideo("invalid"), /Invalid YouTube video ID/);
  assert.equal(store.getState().revision, 0);
});

test("rejects incomplete assets without mutating state", () => {
  const store = new ProgramStore();
  assert.throws(
    () => store.take({ id: "", title: "Bad", fullUrl: "" }),
    /required/,
  );
  assert.equal(store.getState().revision, 0);
  assert.equal(store.getState().mode, "live");
  assert.deepEqual(store.getState().scene, { kind: 'main' });
});
