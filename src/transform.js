import { applyEdits, createScanner, format, SyntaxKind } from "jsonc-parser";
import { parseJsonc } from "./jsonc.js";

const formatOptions = { insertSpaces: true, tabSize: 4, eol: "\n" };

function hasMultipleJsonRoots(source) {
  const scanner = createScanner(source);
  let depth = 0;
  let start = 0;
  let count = 0;

  for (let token = scanner.scan(); token !== SyntaxKind.EOF; token = scanner.scan()) {
    if (scanner.getTokenError()) return false;
    if (token >= SyntaxKind.LineCommentTrivia && token <= SyntaxKind.Trivia) continue;
    const offset = scanner.getTokenOffset();
    if (depth === 0) {
      if (token !== SyntaxKind.OpenBraceToken && token !== SyntaxKind.OpenBracketToken) return false;
      start = offset;
      depth = 1;
    } else if (token === SyntaxKind.OpenBraceToken || token === SyntaxKind.OpenBracketToken) {
      depth += 1;
    } else if (token === SyntaxKind.CloseBraceToken || token === SyntaxKind.CloseBracketToken) {
      depth -= 1;
      if (depth === 0) {
        try {
          parseJsonc(source.slice(start, offset + scanner.getTokenLength()));
        } catch {
          return false;
        }
        count += 1;
      }
    }
  }

  return count > 1 && depth === 0;
}

export function formatJson(source) {
  parseJsonc(source);
  return applyEdits(source, format(source, undefined, formatOptions));
}

export function formatPastedJson(source) {
  try {
    return { text: formatJson(source), formatted: true };
  } catch {
    if (hasMultipleJsonRoots(source)) {
      return { text: applyEdits(source, format(source, undefined, formatOptions)), formatted: true };
    }
    return { text: source, formatted: false };
  }
}

export function minifyJson(source) {
  parseJsonc(source);
  const scanner = createScanner(source);
  let compact = "";
  let afterLineComment = false;
  for (let token = scanner.scan(); token !== SyntaxKind.EOF; token = scanner.scan()) {
    if (token === SyntaxKind.Trivia || token === SyntaxKind.LineBreakTrivia) continue;
    // A line comment must end before the next token, even when removing whitespace.
    if (afterLineComment) compact += "\n";
    const offset = scanner.getTokenOffset();
    compact += source.slice(offset, offset + scanner.getTokenLength());
    afterLineComment = token === SyntaxKind.LineCommentTrivia;
  }

  return compact;
}

export function escapeJson(source) {
  return JSON.stringify(minifyJson(source));
}

export function unescapeJson(source) {
  const value = source.trim();
  if (!value) throw new Error("请先输入需要去转义的内容");

  try {
    const decoded = parseJsonc(value);
    if (typeof decoded === "string") return decoded;
    throw new Error("请输入带转义的 JSON 字符串");
  } catch (error) {
    if (error.message === "请输入带转义的 JSON 字符串") throw error;
    // Also accept copied escaped content without its surrounding quotes.
    if (value.startsWith('"') || !/\\(?:["\\/bfnrt]|u[0-9a-f]{4})/i.test(value)) {
      throw new Error("请输入带转义的 JSON 字符串");
    }
    try {
      return JSON.parse(`"${value}"`);
    } catch {
      throw new Error("转义内容无效，请检查引号和反斜杠");
    }
  }
}

export function stripJsonComments(source) {
  let result = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (inString) {
      result += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
      result += char;
      continue;
    }

    if (char === "/" && next === "/") {
      index += 2;
      while (index < source.length && source[index] !== "\n" && source[index] !== "\r") index += 1;
      if (index < source.length) result += source[index];
      continue;
    }

    if (char === "/" && next === "*") {
      const start = index;
      index += 2;
      let newlines = "";
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        if (source[index] === "\n" || source[index] === "\r") newlines += source[index];
        index += 1;
      }
      if (index >= source.length) throw new Error(`第 ${source.slice(0, start).split("\n").length} 行的块注释没有结束`);
      result += newlines || " ";
      index += 1;
      continue;
    }

    result += char;
  }

  return result;
}
