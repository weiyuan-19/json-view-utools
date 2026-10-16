import test from "node:test";
import assert from "node:assert/strict";
import { json } from "@codemirror/lang-json";
import { codeFolding, foldEffect, foldedRanges, unfoldAll, unfoldEffect } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { foldAllRecursively } from "../src/fold-info.js";

function createView(doc) {
  let state = EditorState.create({ doc, extensions: [json(), codeFolding()] });
  return {
    get state() { return state; },
    dispatch(spec) { state = state.update(spec).state; },
  };
}

function ranges(view) {
  const result = [];
  foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => result.push({ from, to }));
  return result;
}

const source = JSON.stringify({ items: [{ child: { value: 1 } }, { other: [1, 2] }] }, null, 4);

test("fold all collapses every nested object and array, including hidden children", () => {
  const view = createView(source);
  assert.equal(foldAllRecursively(view), true);
  const all = ranges(view);
  assert.equal(all.length, 6);

  view.dispatch({ effects: unfoldEffect.of(all[0]) });
  assert.deepEqual(ranges(view), all.slice(1));
  view.dispatch({ effects: unfoldEffect.of(all[1]) });
  assert.deepEqual(ranges(view), all.slice(2));
  assert.equal(view.state.doc.toString(), source);
});

test("unfold all clears nested folds so reopening a parent reveals expanded children", () => {
  const view = createView(source);
  foldAllRecursively(view);
  const parent = ranges(view)[0];
  assert.equal(unfoldAll(view), true);
  assert.deepEqual(ranges(view), []);
  view.dispatch({ effects: foldEffect.of(parent) });
  view.dispatch({ effects: unfoldEffect.of(parent) });
  assert.deepEqual(ranges(view), []);
  assert.equal(unfoldAll(view), false);
  assert.equal(view.state.doc.toString(), source);
});

test("fold all fills in partially folded trees and repeated clicks do not duplicate folds", () => {
  const view = createView(source);
  view.dispatch({ effects: foldEffect.of({ from: 1, to: source.length - 1 }) });
  foldAllRecursively(view);
  const all = ranges(view);
  assert.equal(all.length, 6);
  foldAllRecursively(view);
  assert.deepEqual(ranges(view), all);
});

test("fold all includes nested structures starting on the same line", () => {
  const view = createView('{"items": [{"child": {\n"value": 1\n}}]}');
  foldAllRecursively(view);
  assert.equal(ranges(view).length, 4);
});

test("fold all parses through a large document to include offscreen structures", () => {
  const view = createView(JSON.stringify(Array.from({ length: 2000 }, (_, value) => ({ child: { value } })), null, 4));
  foldAllRecursively(view);
  assert.equal(ranges(view).length, 4001);
});

test("fold all handles malformed JSON and leaves text unchanged", () => {
  const malformed = '{\n"items": [\n{\n"value": 1,\n}\n]\n}';
  const view = createView(malformed);
  assert.equal(foldAllRecursively(view), true);
  assert.equal(ranges(view).length, 3);
  assert.equal(view.state.doc.toString(), malformed);
});

test("fold all ignores empty documents, primitives, and single-line structures", () => {
  for (const doc of ["", "123", '"text"', '{"items": [{"value": 1}]}']) {
    const view = createView(doc);
    assert.equal(foldAllRecursively(view), false);
    assert.deepEqual(ranges(view), []);
    assert.equal(view.state.doc.toString(), doc);
  }
});
