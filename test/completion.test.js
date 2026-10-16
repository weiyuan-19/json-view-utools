import test from "node:test";
import assert from "node:assert/strict";
import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { jsonPropertyCompletion } from "../src/completion.js";

function complete(source, token, offset = token.length) {
  const pos = source.lastIndexOf(token) + offset;
  const state = EditorState.create({ doc: source });
  return jsonPropertyCompletion(new CompletionContext(state, pos, false));
}

test("suggests quoting a bare JSON property without changing existing keys", () => {
  const source = '{"arr": [], arr}';
  const result = complete(source, "arr");
  assert.equal(result.from, source.lastIndexOf("arr"));
  assert.equal(result.to, source.lastIndexOf("arr") + 3);
  assert.deepEqual(result.options.map(({ label, apply }) => ({ label, apply })), [
    { label: '"arr"', apply: '"arr"' },
  ]);
  assert.equal(source.slice(0, result.from) + result.options[0].apply + source.slice(result.to), '{"arr": [], "arr"}');
});

test("does not offer property quoting in values, arrays, or quoted keys", () => {
  assert.equal(complete('{"x": arr}', "arr"), null);
  assert.equal(complete('[arr]', "arr"), null);
  assert.equal(complete('{"arr": 1}', "arr"), null);
  assert.equal(complete('{"x": {foo: 1}}', "foo")?.options[0].apply, '"foo"');
});

test("still suggests quotes when the JSON is missing a comma before a property", () => {
  assert.equal(complete('{\n  "arr": [1, 2, 3]\n  dsd\n}', "dsd")?.options[0].apply, '"dsd"');
  assert.equal(complete('{\n  "a": 1\n  next\n}', "next")?.options[0].apply, '"next"');
  assert.equal(complete('[\n  [1]\n  dsd\n]', "dsd"), null);
  assert.equal(complete('{\n  "a": dsd\n}', "dsd"), null);
});

test("ignores words inside comments and still completes keys after comments", () => {
  assert.equal(complete('{\n// note\n}', "note"), null);
  assert.equal(complete('{\n/* note */\n}', "note"), null);
  assert.equal(complete('{\n/* unfinished', "unfinished"), null);
  assert.equal(complete('{"text": "two words"}', "words"), null);
  assert.equal(complete('{\n// note\nkey: 1}', "key")?.options[0].apply, '"key"');
  assert.equal(complete('{ /* note */ key: 1}', "key")?.options[0].apply, '"key"');
});
