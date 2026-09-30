import test from "node:test";
import assert from "node:assert/strict";
import { collectJsonDiagnostics } from "../src/diagnostics.js";

test("marks JSON syntax errors with useful ranges and messages", () => {
  const source = '{"items":[1 2]}\n{}';
  const problems = collectJsonDiagnostics(source);
  assert.ok(problems.some((problem) => problem.severity === "error" && problem.message.includes("逗号") && source.slice(problem.from, problem.to) === "2"));
  assert.ok(problems.some((problem) => problem.message.includes("多余内容")));
  assert.deepEqual(collectJsonDiagnostics("   "), []);
  assert.deepEqual(collectJsonDiagnostics('{"items":[1,2]}'), []);
});

test("marks trailing commas themselves in objects and arrays", () => {
  for (const source of ['{"a":1,}', '{"a":1, \n }', '[1,2,]', '[1,2, \n ]']) {
    const trailing = collectJsonDiagnostics(source);
    assert.equal(trailing.length, 1);
    assert.match(trailing[0].message, /多余逗号/);
    assert.equal(source.slice(trailing[0].from, trailing[0].to), ",");
  }
});

test("rejects comments", () => {
  assert.ok(collectJsonDiagnostics('// note\n{"a":1}').some((problem) => problem.message.includes("注释")));
});

test("warns on every occurrence of repeated keys within the same object", () => {
  const source = '{"a":1,"nested":{"a":2},"a":3,"\\u0061":4}';
  const warnings = collectJsonDiagnostics(source).filter((problem) => problem.severity === "warning");
  assert.equal(warnings.length, 3);
  assert.deepEqual(warnings.map((problem) => source.slice(problem.from, problem.to)), ['"a"', '"a"', '"\\u0061"']);
  assert.ok(warnings.every((problem) => problem.message.includes("重复（共 3 处）")));
});
