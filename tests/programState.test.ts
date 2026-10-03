import assert from "node:assert/strict";
import test from "node:test";
import { ProgramStore } from "../server/programState.js";
import type { Asset } from "../src/shared/types.js";

const asset: Asset = {
  id: "test",
  title: "Test graphic",
  fullUrl: "/test-graphic.svg",
};

test("starts in a safe live state", () => {
  const store = new ProgramStore();
  assert.deepEqual(store.getState(), {
    videoId: null,
    mode: "live",
    activeAsset: null,
    revision: 0,
  });
});

test("accepted commands advance revision and preserve invariants", () => {
  const store = new ProgramStore();
  assert.equal(store.setVideo("dQw4w9WgXcQ").revision, 1);

  const graphic = store.take(asset);
  assert.equal(graphic.revision, 2);
  assert.equal(graphic.mode, "graphic");
  assert.deepEqual(graphic.activeAsset, asset);

  const live = store.goLive();
  assert.equal(live.revision, 3);
  assert.equal(live.mode, "live");
  assert.equal(live.activeAsset, null);
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
});
