import test from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { codeFolding, ensureSyntaxTree, foldable, foldedRanges, matchBrackets } from "@codemirror/language";
import { highlightTree, tagHighlighter, tags } from "@lezer/highlight";
import { jsonc, jsoncLanguage } from "../src/jsonc-language.js";
import { describeFold, foldAllRecursively } from "../src/fold-info.js";
import { activeJsonScope, guidesForLine } from "../src/scope-guides.js";

const source = '// head { "fake": [\n{\n    "items": [ // ] } "fake"\n        { /* } ] */ "value": 1 },\n        2\n    ]\n} /* tail */';

test("JSONC syntax highlights comments and ignores their brackets and quotes", () => {
  const tree = jsoncLanguage.parser.parse(source);
  const errors = [];
  tree.iterate({ enter(node) { if (node.type.isError) errors.push(node.from); } });
  assert.deepEqual(errors, []);

  const comments = [];
  highlightTree(tree, tagHighlighter([{ tag: tags.comment, class: "comment" }]), (from, to) => comments.push(source.slice(from, to)));
  assert.deepEqual(comments, ['// head { "fake": [', '// ] } "fake"', '/* } ] */', '/* tail */']);

  for (const comment of ["/**/", "/***/", "/****/", "/* * ** text / */", "/* first\r\nsecond */"]) {
    const parsed = jsoncLanguage.parser.parse(`${comment} {"a":1}`);
    assert.equal(parsed.topNode.firstChild.name, "BlockComment");
    assert.equal(parsed.topNode.lastChild.name, "Object");
    assert.ok(!parsed.toString().includes("⚠"));
  }
});

test("JSONC folding, bracket matching, and guides use real structures", () => {
  let state = EditorState.create({
    doc: source,
    selection: { anchor: source.indexOf("2") },
    extensions: [jsonc(), codeFolding()],
  });
  const root = foldable(state, state.doc.line(2).from, state.doc.line(2).to);
  const array = foldable(state, state.doc.line(3).from, state.doc.line(3).to);
  assert.equal(describeFold(state, root), "1 项");
  assert.equal(describeFold(state, array), "2 项");
  const active = activeJsonScope(state);
  assert.equal(source[active.from], "[");
  assert.equal(active.closeLine, 6);
  assert.deepEqual(guidesForLine(state, state.doc.line(5), active), [
    { column: 0, active: false },
    { column: 4, active: true },
  ]);
  const match = matchBrackets(state, active.from, 1, {});
  assert.equal(match.matched, true);
  assert.equal(match.end.from, source.lastIndexOf("]"));

  foldAllRecursively({
    get state() { return state; },
    dispatch(spec) { state = state.update(spec).state; },
  });
  assert.equal(foldedRanges(state).size, 2);
});

test("JSONC reparses correctly after adding or closing a comment", () => {
  let state = EditorState.create({ doc: '{\n"value": 1\n}', extensions: [jsonc()] });
  state = state.update({ changes: { from: 1, insert: '// "note" { [' } }).state;
  let tree = ensureSyntaxTree(state, state.doc.length, 100);
  assert.ok(!tree.toString().includes("⚠"));
  assert.ok(tree.toString().includes("LineComment"));
  state = state.update({ changes: { from: 0, insert: "/* note */ " } }).state;
  tree = ensureSyntaxTree(state, state.doc.length, 100);
  assert.ok(!tree.toString().includes("⚠"));
  assert.equal(tree.topNode.firstChild.name, "BlockComment");
});
