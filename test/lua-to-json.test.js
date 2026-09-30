import test from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { escapedJsonItems } from "../src/inner-unescape.js";
import { luaTableToJson } from "../src/lua-to-json.js";

test("converts the Lua table from an escaped JSON string", () => {
  const lua = '{["point"]={["x"]=297,["y"]=232,},["code"]=0,}';
  assert.equal(luaTableToJson(lua), '{"point":{"x":297,"y":232},"code":0}');

  const source = JSON.stringify({ args: lua, keep: true });
  const [item] = escapedJsonItems(source);
  const state = EditorState.create({ doc: source });
  const updated = state.update({ changes: { from: item.from, to: item.to, insert: luaTableToJson(item.decoded) } });
  assert.deepEqual(JSON.parse(updated.state.doc.toString()), {
    args: { point: { x: 297, y: 232 }, code: 0 },
    keep: true,
  });
});

test("converts arrays, named fields, comments, booleans, and duplicate keys", () => {
  assert.equal(luaTableToJson('{1,2,3,}'), '[1,2,3]');
  assert.equal(luaTableToJson('{foo=true; bar={"a", "b"}, -- note\n}'), '{"foo":true,"bar":["a","b"]}');
  assert.equal(luaTableToJson('{["x"]=1,["x"]=2}'), '{"x":1,"x":2}');
  assert.equal(luaTableToJson('{[2]="b",[1]="a"}'), '["a","b"]');
});

test("rejects Lua expressions that would require executing code", () => {
  assert.throws(() => luaTableToJson('{value=os.execute("echo hi")}'), /不支持 Lua 表达式/);
  assert.throws(() => luaTableToJson('{value=nil}'), /nil 无法无损转换/);
  assert.throws(() => luaTableToJson('{["x"]=1+2}'), SyntaxError);
});
