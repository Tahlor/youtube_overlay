import assert from 'node:assert/strict';
import test from 'node:test';
import { ProgramStore } from '../server/programState.js';
import { DEFAULT_PRESENTATION, imageMotionVariant, normalizePresentation } from '../src/shared/presentation.js';
import type { PresentationSettings } from '../src/shared/types.js';

const asset = { id: 'test', title: 'Test graphic', fullUrl: '/test-graphic.svg' };
test('all presentation layouts and positions round trip without changing playback', () => {
  const program = new ProgramStore(); program.setVideo('aqz-KE-bpKQ');
  program.controlPlayback({ videoId: 'aqz-KE-bpKQ', playbackRevision: program.getState().playback.revision, action: 'pause', position: 100 });
  const playback = program.getState().playback;
  for (const layout of ['shoulder', 'pip', 'image'] as const) for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const) {
    const presentation: PresentationSettings = { layout, corner, size: 'large', fit: 'cover', transition: 'slide', motion: 'still' };
    const taken = program.take(asset, presentation);
    assert.equal(taken.mode, 'graphic'); assert.deepEqual(taken.presentation, presentation); assert.deepEqual(taken.playback, playback);
    assert.deepEqual(taken.scene, { kind: 'image', asset, presentation });
    assert.deepEqual(new ProgramStore(taken).getState(), taken);
    const live = program.goLive();
    assert.equal(live.mode, 'live'); assert.equal(live.activeAsset, null); assert.deepEqual(live.playback, playback); assert.deepEqual(live.presentation, presentation);
  }
});

test('legacy saved Program migrates scene and uses auto motion semantically without changing its wire shape', () => {
  const program = new ProgramStore({ videoId: null, mode: 'live', activeAsset: null, revision: 1 });
  assert.deepEqual(program.getState().presentation, DEFAULT_PRESENTATION);
  assert.deepEqual(program.getState().scene, { kind: 'main' });
  const taken = program.take(asset); taken.presentation.corner = 'top-left';
  assert.deepEqual(program.getState().presentation, DEFAULT_PRESENTATION);

  const legacyPresentation: PresentationSettings = { layout: 'image', corner: 'bottom-right', size: 'medium', transition: 'fade', fit: 'contain' };
  const legacyGraphic = new ProgramStore({
    videoId: null,
    mode: 'graphic',
    activeAsset: asset,
    revision: 2,
    presentation: legacyPresentation,
  }).getState();
  assert.equal(legacyGraphic.presentation.motion ?? 'auto', 'auto');
  assert.deepEqual(legacyGraphic.presentation, legacyPresentation);
  assert.deepEqual(legacyGraphic.scene, { kind: 'image', asset, presentation: legacyPresentation });
});

test('motion variants are deterministic and bounded', () => {
  const first = imageMotionVariant(asset);
  assert.equal(imageMotionVariant(asset), first);
  assert.ok(first >= 0 && first <= 3);
});

test('invalid presentation is rejected before Program or playback mutates', () => {
  const program = new ProgramStore(); const before = program.getState();
  for (const value of [{}, 'pip', { ...DEFAULT_PRESENTATION, layout: 'other' }, { ...DEFAULT_PRESENTATION, corner: 'center' }, { ...DEFAULT_PRESENTATION, size: 4 }, { ...DEFAULT_PRESENTATION, transition: 'slow' }, { ...DEFAULT_PRESENTATION, fit: 'stretch' }, { ...DEFAULT_PRESENTATION, motion: 'spin' }]) {
    assert.throws(() => program.take(asset, value)); assert.deepEqual(program.getState(), before);
    assert.throws(() => normalizePresentation(value));
  }
});
