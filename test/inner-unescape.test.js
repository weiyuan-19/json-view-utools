import test from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { decodedItemChanges, escapedJsonItems, luaJsonItemChanges } from "../src/inner-unescape.js";

test("finds escaped string values across the whole document", () => {
  const source = JSON.stringify({ args: '{["point"]={["x"]=297}}', plain: "hello" }, null, 4);
  const items = escapedJsonItems(source);
  assert.equal(items.length, 1);
  assert.equal(items[0].decoded, '{["point"]={["x"]=297}}');
  assert.deepEqual(items[0].path, ["args"]);
  assert.deepEqual(escapedJsonItems('{"escaped\\nkey":"plain"}'), []);
});

test("each listed item can replace its corresponding original value", () => {
  const source = JSON.stringify({ payload: '{"x":1,"x":2}' });
  const [item] = escapedJsonItems(source);
  const replaced = source.slice(0, item.from) + item.decoded + source.slice(item.to);
  assert.equal(replaced, '{"payload":{"x":1,"x":2}}');
  assert.equal((replaced.match(/"x"/g) ?? []).length, 2);
  assert.deepEqual(JSON.parse(replaced), { payload: { x: 2 } });
  const nonJson = JSON.stringify({ args: '{["point"]=1}' });
  const [decoded] = escapedJsonItems(nonJson);
  assert.equal(nonJson.slice(0, decoded.from) + decoded.decoded + nonJson.slice(decoded.to), '{"args":{["point"]=1}}');
  const items = escapedJsonItems(JSON.stringify({ a: '{"x":1}', b: '{"y":2}' }));
  assert.deepEqual(items.map(({ path, decoded }) => ({ path, decoded })), [
    { path: ["a"], decoded: '{"x":1}' },
    { path: ["b"], decoded: '{"y":2}' },
  ]);
});

test("replaces all decoded items in one edit without shifting later ranges", () => {
  const source = JSON.stringify({ a: '{"x":1}', b: '{"y":2}' });
  const state = EditorState.create({ doc: source });
  const next = state.update({ changes: decodedItemChanges(escapedJsonItems(source)) }).state.doc.toString();
  assert.equal(next, '{"a":{"x":1},"b":{"y":2}}');
});

test("converts every Lua result in one edit and leaves the document intact if one fails", () => {
  const source = JSON.stringify({ args: '{["point"]={["x"]=297,},}', args2: '{["code"]=0,}' }, null, 4);
  const items = escapedJsonItems(source);
  const changes = luaJsonItemChanges(items, source);
  assert.equal(changes.length, 2);
  const state = EditorState.create({ doc: source });
  const next = state.update({ changes }).state.doc.toString();
  assert.deepEqual(JSON.parse(next), { args: { point: { x: 297 } }, args2: { code: 0 } });
  assert.match(next, /"args": \{\n        "point": \{/);

  const mixed = JSON.stringify({ args: '{["code"]=0,}', args2: 'not a "Lua" table' });
  assert.equal(escapedJsonItems(mixed).length, 2);
  assert.throws(() => luaJsonItemChanges(escapedJsonItems(mixed), mixed), /请输入 Lua 表构造器/);
});
