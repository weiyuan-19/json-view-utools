import test from "node:test";
import assert from "node:assert/strict";
import { overviewTop } from "../src/overview.js";

test("overview markers align with short documents instead of stretching to the viewport", () => {
  assert.equal(overviewTop(250, 500, 1000), 250);
  assert.equal(overviewTop(400, 500, 1000), 400);
});

test("overview markers map long documents to the scrollbar track", () => {
  assert.equal(overviewTop(800, 2000, 500), 200);
  assert.equal(overviewTop(2000, 2000, 500), 496);
  assert.equal(overviewTop(0, 2000, 500), 4);
});
