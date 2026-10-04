import assert from 'node:assert/strict';
import test from 'node:test';
import { ProgramStore } from '../server/programState.js';
import { DEFAULT_PRESENTATION, normalizePresentation } from '../src/shared/presentation.js';
import type { PresentationSettings } from '../src/shared/types.js';

const asset = { id: 'test', title: 'Test graphic', fullUrl: '/test-graphic.svg' };
test('all presentation layouts and positions round trip without changing playback', () => {
  const program = new ProgramStore(); program.setVideo('aqz-KE-bpKQ');
  program.controlPlayback({ videoId: 'aqz-KE-bpKQ', playbackRevision: program.getState().playback.revision, action: 'pause', position: 100 });
  const playback = program.getState().playback;
  for (const layout of ['shoulder', 'pip', 'image'] as const) for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const) {
    const presentation: PresentationSettings = { layout, corner, size: 'large', fit: 'cover', transition: 'slide' };
    const taken = program.take(asset, presentation);
    assert.equal(taken.mode, 'graphic'); assert.deepEqual(taken.presentation, presentation); assert.deepEqual(taken.playback, playback);
    assert.deepEqual(new ProgramStore(taken).getState(), taken);
    const live = program.goLive();
    assert.equal(live.mode, 'live'); assert.equal(live.activeAsset, null); assert.deepEqual(live.playback, playback); assert.deepEqual(live.presentation, presentation);
  }
});

test('legacy saved Program migrates presentation; returned settings cannot mutate the store', () => {
  const program = new ProgramStore({ videoId: null, mode: 'live', activeAsset: null, revision: 1 });
  assert.deepEqual(program.getState().presentation, DEFAULT_PRESENTATION);
  const taken = program.take(asset); taken.presentation.corner = 'top-left';
  assert.deepEqual(program.getState().presentation, DEFAULT_PRESENTATION);
});

test('invalid presentation is rejected before Program or playback mutates', () => {
  const program = new ProgramStore(); const before = program.getState();
  for (const value of [{}, 'pip', { ...DEFAULT_PRESENTATION, layout: 'other' }, { ...DEFAULT_PRESENTATION, corner: 'center' }, { ...DEFAULT_PRESENTATION, size: 4 }, { ...DEFAULT_PRESENTATION, transition: 'slow' }, { ...DEFAULT_PRESENTATION, fit: 'stretch' }]) {
    assert.throws(() => program.take(asset, value)); assert.deepEqual(program.getState(), before);
    assert.throws(() => normalizePresentation(value));
  }
});
