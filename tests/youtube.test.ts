import assert from "node:assert/strict";
import test from "node:test";
import { parseYouTubeVideoId } from "../src/shared/youtube.js";

const id = "dQw4w9WgXcQ";

test("accepts a bare video ID", () => {
  assert.equal(parseYouTubeVideoId(id), id);
});

test("parses common YouTube URL forms", () => {
  assert.equal(parseYouTubeVideoId(`https://www.youtube.com/watch?v=${id}&t=3`), id);
  assert.equal(parseYouTubeVideoId(`https://youtu.be/${id}`), id);
  assert.equal(parseYouTubeVideoId(`https://www.youtube.com/live/${id}?feature=share`), id);
  assert.equal(parseYouTubeVideoId(`https://www.youtube.com/embed/${id}`), id);
  assert.equal(parseYouTubeVideoId(`https://m.youtube.com/watch?v=${id}`), id);
});

test("rejects unrelated and malformed inputs", () => {
  assert.equal(parseYouTubeVideoId(""), null);
  assert.equal(parseYouTubeVideoId("not youtube"), null);
  assert.equal(parseYouTubeVideoId("https://example.com/watch?v=dQw4w9WgXcQ"), null);
  assert.equal(parseYouTubeVideoId("https://youtube.com/watch?v=too-short"), null);
});
