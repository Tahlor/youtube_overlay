import assert from 'node:assert/strict';
import test from 'node:test';
import { ProgramStore } from '../server/programState.js';
import { formatTime, parseTime, playbackPosition } from '../src/shared/playback.js';
import type { PlaybackCommand } from '../src/shared/types.js';

const videoId = 'aqz-KE-bpKQ';
function control(store: ProgramStore, action: PlaybackCommand['action'], values: { position?: number; seconds?: number } = {}, observed?: number, duration?: number) {
  return store.controlPlayback({ videoId, playbackRevision: store.getState().playback.revision, action, ...values }, observed, duration);
}

test('shared playback preserves pause through seek, skip, graphics and LIVE', () => {
  const store = new ProgramStore(); store.setVideo(videoId);
  assert.equal(control(store, 'pause', { position: 100 }).playback.position, 100);
  assert.equal(control(store, 'seek', { position: 300 }).playback.status, 'paused');
  assert.equal(control(store, 'skip', { seconds: -10 }).playback.position, 290);
  assert.equal(control(store, 'skip', { seconds: 10 }).playback.position, 300);
  const before = store.getState().playback;
  store.take({ id: 'test', title: 'Test', fullUrl: '/test-graphic.svg' }); store.goLive();
  assert.deepEqual(store.getState().playback, before);
  const playing = control(store, 'play').playback;
  assert.equal(playing.status, 'playing');
  assert.equal(playbackPosition(playing, playing.updatedAt + 5000), 305);
  assert.equal(playbackPosition(before, before.updatedAt + 5000), 300);
});

test('TV position wins for pause and skip; seeks are absolute and skips clamp', () => {
  const store = new ProgramStore(); store.setVideo(videoId);
  assert.equal(control(store, 'pause', { position: 50 }, 200).playback.position, 200);
  assert.equal(control(store, 'skip', { seconds: -10 }, 500, 600).playback.position, 490);
  assert.equal(control(store, 'seek', { position: 300 }, 500, 600).playback.position, 300);
  assert.equal(control(store, 'skip', { seconds: -3600 }).playback.position, 0);
  assert.equal(control(store, 'skip', { seconds: 100 }, 580, 600).playback.position, 600);
});

test('invalid and stale playback commands never mutate Program', () => {
  const store = new ProgramStore();
  assert.throws(() => control(store, 'play'));
  store.setVideo(videoId);
  assert.throws(() => control(store, 'pause'), /Wait for the player/);
  const before = store.getState();
  const base = { videoId, playbackRevision: before.playback.revision, action: 'seek' };
  for (const bad of [null, {}, { ...base, position: NaN }, { ...base, position: Infinity }, { ...base, position: -1 }, { ...base, position: '10' }, { ...base, action: 'skip', seconds: 3601 }, { ...base, action: 'skip', seconds: null }, { ...base, action: 'other' }, { ...base, videoId: 'dQw4w9WgXcQ', position: 10 }, { ...base, playbackRevision: 0, position: 10 }]) {
    assert.throws(() => store.controlPlayback(bad as PlaybackCommand));
    assert.deepEqual(store.getState(), before);
  }
});

test('new video resets playback; saved pauses and legacy snapshots restore', () => {
  const store = new ProgramStore(); store.setVideo(videoId); control(store, 'pause', { position: 123 });
  const saved = store.getState();
  assert.deepEqual(new ProgramStore(saved).getState(), saved);
  store.setVideo('dQw4w9WgXcQ');
  assert.equal(store.getState().playback.status, 'playing'); assert.equal(store.getState().playback.position, null);
  const { playback: _playback, ...legacy } = saved;
  assert.equal(new ProgramStore(legacy).getState().playback.position, null);
  assert.throws(() => new ProgramStore({ ...saved, playback: { ...saved.playback, position: -1 } }));
});

test('time entry accepts seconds and timestamps, rejecting ambiguous or impossible input', () => {
  for (const [value, expected] of [['90', 90], ['1:30', 90], ['1:02:03', 3723], ['0:00', 0], [' 2:15 ', 135]] as const) assert.equal(parseTime(value), expected);
  for (const bad of ['', '1:60', '1:60:00', '-1', 'Infinity', '1:2:3:4', 'one', '9999999999']) assert.equal(parseTime(bad), null);
  assert.equal(formatTime(90), '1:30'); assert.equal(formatTime(3723), '1:02:03');
});
