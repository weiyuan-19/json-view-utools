import test from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { replaceAll, search, SearchQuery, setSearchQuery } from "@codemirror/search";
import { collectSearchMatches, replacementForMatch } from "../src/search-panel.js";

test("search matches respect case, whole words, regular expressions, and a selected range", () => {
  let state = EditorState.create({ doc: '"args": 1, "args2": 2, "args": 3', extensions: [search()] });
  const matches = (query) => {
    state = state.update({ effects: setSearchQuery.of(new SearchQuery(query)) }).state;
    return collectSearchMatches(state).map(({ from, to }) => state.doc.sliceString(from, to));
  };

  assert.deepEqual(matches({ search: "args", wholeWord: true }), ["args", "args"]);
  assert.deepEqual(matches({ search: "ARGS", caseSensitive: true }), []);
  assert.deepEqual(matches({ search: "args\\d?", regexp: true }), ["args", "args2", "args"]);
  assert.deepEqual(matches({ search: "args", test: (_match, _state, from) => from > 15 }), ["args"]);
  assert.deepEqual(matches({ search: "[", regexp: true }), []);
});

test("replace all applies regular-expression groups only to search matches", () => {
  let state = EditorState.create({ doc: "code-1 code-2 code-3", extensions: [search()] });
  state = state.update({ effects: setSearchQuery.of(new SearchQuery({
    search: "code-(\\d)",
    replace: "item:$1",
    regexp: true,
    test: (_match, _state, from) => from < 14,
  })) }).state;
  const view = {
    get state() { return state; },
    dispatch(spec) { state = state.update(spec).state; },
  };
  assert.equal(replaceAll(view), true);
  assert.equal(state.doc.toString(), "item:1 item:2 code-3");
});

test("preserve-case replacement follows the matched text and expands regexp groups", () => {
  const query = new SearchQuery({ search: "(foo)-(\\d)", replace: "bar-$2", regexp: true });
  const state = EditorState.create({ doc: "FOO-1 Foo-2 foo-3" });
  const matches = [...query.getCursor(state)];
  assert.deepEqual(matches.map((match) => replacementForMatch(query, match, state.doc.sliceString(match.from, match.to), true)),
    ["BAR-1", "Bar-2", "bar-3"]);
});
