import { getNodePath, parseTree } from "jsonc-parser";
import { luaTableToJson } from "./lua-to-json.js";
import { formatJson } from "./transform.js";

function decodeItem(source, node) {
  if (node?.type !== "string") return null;
  const literal = source.slice(node.offset, node.offset + node.length);
  if (!literal.includes("\\")) return null;

  let decoded;
  try {
    decoded = JSON.parse(literal);
  } catch {
    throw new Error("当前字符串的转义格式无效");
  }

  return { from: node.offset, to: node.offset + node.length, decoded, path: getNodePath(node) };
}

export function escapedJsonItems(source) {
  const tree = parseTree(source);
  const items = [];
  function collect(node) {
    if (node.type === "string" && !(node.parent?.type === "property" && node.parent.children?.[0] === node)) {
      const item = decodeItem(source, node);
      if (item) items.push(item);
    }
    for (const child of node.children ?? []) collect(child);
  }
  if (tree) collect(tree);
  return items;
}

export function decodedItemChanges(items) {
  return [...items].sort((a, b) => a.from - b.from)
    .map(({ from, to, decoded }) => ({ from, to, insert: decoded }));
}

export function luaJsonItemChanges(items, source) {
  return [...items].sort((a, b) => a.from - b.from).map(({ from, to, decoded }) => {
    const lineStart = source.lastIndexOf("\n", from - 1) + 1;
    const indentation = source.slice(lineStart, from).match(/^\s*/)[0];
    const insert = formatJson(luaTableToJson(decoded)).replace(/\n/g, `\n${indentation}`);
    return { from, to, insert };
  });
}
