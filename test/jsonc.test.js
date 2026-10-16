import test from "node:test";
import assert from "node:assert/strict";
import { parseJsonc, startsWithJsonContainer } from "../src/jsonc.js";

test("parses JSONC with comments while preserving comment-like string values", () => {
  const source = '// head\r\n{"url": "https://test/", /* block */ "text": "/* literal */", "items": [1, 2]} // tail';
  assert.deepEqual(parseJsonc(source), { url: "https://test/", text: "/* literal */", items: [1, 2] });
});

test("rejects malformed JSONC instead of returning recovered values", () => {
  for (const source of ['{"a":}', '{"a":1, /* tail */}', '{"a":1 /* unfinished', '1/* gap */2', '{}\n{}', '"\\x"']) {
    assert.throws(() => parseJsonc(source), SyntaxError);
  }
  assert.throws(() => parseJsonc('{\r\n"a": 1,\r\n"b":\r\n}'), /第 4 行/);
});

test("recognizes objects and arrays after leading comments for unescaping", () => {
  assert.equal(startsWithJsonContainer('// head\n{"a":1}'), true);
  assert.equal(startsWithJsonContainer('/* head */ [1, 2]'), true);
  assert.equal(startsWithJsonContainer('"{\\"a\\":1}"'), false);
  assert.equal(startsWithJsonContainer('/* head */ 123'), false);
});
