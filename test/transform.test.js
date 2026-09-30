import test from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { json } from "@codemirror/lang-json";
import { codeFolding, foldable } from "@codemirror/language";
import { describeFold } from "../src/fold-info.js";
import { collectJsonDiagnostics } from "../src/diagnostics.js";
import { activeJsonScope, bracketJsonScope, guidesForLine } from "../src/scope-guides.js";
import { escapeJson, formatJson, formatPastedJson, minifyJson, stripJsonComments, unescapeJson } from "../src/transform.js";

test("formats valid JSON with four spaces and compresses it again", () => {
  const input = '{"user":{"id":1,"active":true}}';
  const formatted = formatJson(input);
  assert.equal(formatted, '{\n    "user": {\n        "id": 1,\n        "active": true\n    }\n}');
  assert.equal(minifyJson(formatted), input);
  assert.throws(() => formatJson('{"id":}'), SyntaxError);
  assert.throws(() => minifyJson('{"id":}'), SyntaxError);
});

test("escape compresses JSON and produces a reversible string literal", () => {
  const source = '{\n  "text": "中文\\nline"\n}';
  assert.equal(unescapeJson(escapeJson(source)), minifyJson(source));
  assert.equal(unescapeJson(escapeJson(source).slice(1, -1)), minifyJson(source));
  assert.throws(() => escapeJson('{broken'), SyntaxError);
  assert.throws(() => unescapeJson('{"ok":true}'), /带转义/);
});

test("removes comments outside strings without changing URLs or escaped quotes", () => {
  const source = '{\n  // note\n  "url": "https://a.test/\\\"//\\\"", /* block */\n  "ok": true // tail\n}';
  const result = stripJsonComments(source);
  assert.deepEqual(JSON.parse(result), { url: 'https://a.test/"//"', ok: true });
  assert.ok(!result.includes("note"));
  assert.ok(!result.includes("block"));
  assert.throws(() => stripJsonComments('{ /* never ends'), /没有结束/);
});

test("formats valid pasted text and leaves incomplete pasted text editable", () => {
  assert.deepEqual(formatPastedJson('{"a":[1,2]}'), {
    text: '{\n    "a": [\n        1,\n        2\n    ]\n}',
    formatted: true,
  });
  assert.deepEqual(formatPastedJson('{"a":'), { text: '{"a":', formatted: false });
});

test("formats consecutive JSON records while retaining the top-level syntax error", () => {
  const source = [
    JSON.stringify({ uid: 100001, protoname: "req_save_client_data", args: '{["code"]=0,}', have_rsp: true }),
    JSON.stringify({ uid: 100001, protoname: "req_kitchen_eat_finish", args: '{["count"]=32,}', time: 1790672236 }),
    JSON.stringify({ uid: 100001, protoname: "req_kitchen_eat_finish", args: '{["code"]=0,}', have_rsp: true }),
  ].join("\n");
  const result = formatPastedJson(source);
  assert.equal(result.formatted, true);
  assert.equal((result.text.match(/"uid"/g) ?? []).length, 3);
  assert.match(result.text, /"args": "\{\[\\"count\\"\]=32,\}"/);
  assert.match(result.text, /\n}\n{\n/);
  assert.equal(collectJsonDiagnostics(result.text)[0].message, "顶层 JSON 值之后还有多余内容");

  const malformed = '{"ok":1}\n{"missing":}';
  assert.deepEqual(formatPastedJson(malformed), { text: malformed, formatted: false });
});

test("formatting, minifying, and compact escaping preserve repeated keys and original value text", () => {
  const source = '{\n  "arr" : [1, 2, 3],\n  "arr" : [],\n  "literal": "\\u0061",\n  "exponent": 1e+2\n}';
  const formatted = formatPastedJson(source);
  assert.equal(formatted.formatted, true);
  assert.equal((formatted.text.match(/"arr"/g) ?? []).length, 2);
  assert.match(formatted.text, /"arr": \[\n        1,\n        2,\n        3\n    \]/);
  assert.match(formatted.text, /"literal": "\\u0061"/);
  assert.match(formatted.text, /"exponent": 1e\+2/);

  const compact = '{"arr":[1,2,3],"arr":[],"literal":"\\u0061","exponent":1e+2}';
  assert.equal(minifyJson(source), compact);
  assert.equal(unescapeJson(escapeJson(source)), compact);
});

test("fold previews show the number of array items and object properties", () => {
  const state = EditorState.create({
    doc: '{\n  "items": [\n    1,\n    2,\n    3\n  ]\n}',
    extensions: [json(), codeFolding()],
  });
  const objectRange = foldable(state, 0, state.doc.line(1).to);
  const arrayLine = state.doc.line(2);
  const arrayRange = foldable(state, arrayLine.from, arrayLine.to);
  assert.ok(objectRange);
  assert.ok(arrayRange);
  assert.equal(describeFold(state, objectRange), "1 项");
  assert.equal(describeFold(state, arrayRange), "3 项");
});

test("nested JSON scopes identify the active brackets and guide levels", () => {
  const source = '{\n    "arr": [\n        1,\n        2,\n        3\n    ]\n}';
  const state = EditorState.create({
    doc: source,
    selection: { anchor: source.indexOf("3") },
    extensions: [json()],
  });
  const active = activeJsonScope(state);
  assert.equal(source[active.from], "[");
  assert.equal(source[active.to - 1], "]");
  assert.equal(active.openLine, 2);
  assert.equal(active.closeLine, 6);
  const opening = EditorState.create({
    doc: source,
    selection: { anchor: source.indexOf("[") },
    extensions: [json()],
  });
  assert.equal(activeJsonScope(opening).from, source.indexOf("["));
  assert.equal(bracketJsonScope(opening).from, source.indexOf("["));
  const inside = EditorState.create({ doc: source, selection: { anchor: source.indexOf("3") }, extensions: [json()] });
  assert.equal(bracketJsonScope(inside), null);
  const closing = EditorState.create({ doc: source, selection: { anchor: source.indexOf("]") + 1 }, extensions: [json()] });
  assert.equal(bracketJsonScope(closing).to - 1, source.indexOf("]"));
  const rootOpening = EditorState.create({ doc: source, selection: { anchor: 0 }, extensions: [json()] });
  assert.equal(activeJsonScope(rootOpening).from, 0);
  assert.deepEqual(guidesForLine(state, state.doc.line(5), active), [
    { column: 0, active: false },
    { column: 4, active: true },
  ]);
  assert.deepEqual(guidesForLine(state, state.doc.line(6), active), [
    { column: 0, active: false },
  ]);
});
