import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const plugin = JSON.parse(readFileSync(new URL("../public/plugin.json", import.meta.url), "utf8"));
const packageConfig = JSON.parse(readFileSync(new URL("../public/package.json", import.meta.url), "utf8"));

test("opens from a command, JSON shaped text, or one JSON or JSONC file", () => {
  assert.equal(plugin.main, "index.html");
  assert.equal(plugin.preload, "preload.js");
  assert.equal(packageConfig.type, "commonjs");
  assert.ok(existsSync(new URL(`../public/${plugin.preload}`, import.meta.url)));
  assert.equal(plugin.pluginSetting.single, false);
  assert.equal(plugin.features[0].mainHide, undefined);
  const commands = plugin.features[0].cmds;
  assert.ok(commands.includes("JSON 编辑器"));

  const regex = commands.find((command) => command.type === "regex");
  const parts = /^\/([\s\S]*)\/([a-z]*)$/.exec(regex.match);
  const matches = new RegExp(parts[1], parts[2]);
  assert.equal(matches.test('{"name":"test"}'), true);
  assert.equal(matches.test('  [1, 2]  '), true);
  assert.equal(matches.test("ordinary text"), false);

  const files = commands.find((command) => command.type === "files");
  assert.equal(files.fileType, "file");
  assert.deepEqual(files.extensions, ["json", "jsonc"]);
  assert.equal(files.maxLength, 1);
});
