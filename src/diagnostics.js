import { parseTree, printParseErrorCode } from "jsonc-parser";

const errorMessages = {
  InvalidSymbol: "无效字符，无法识别为 JSON 值",
  InvalidNumberFormat: "数字格式不正确",
  PropertyNameExpected: "这里需要双引号包裹的属性名",
  ValueExpected: "这里需要 JSON 值",
  ColonExpected: "属性名后缺少冒号 :",
  CommaExpected: "相邻项目之间缺少逗号 ,",
  CloseBraceExpected: "缺少右花括号 }",
  CloseBracketExpected: "缺少右方括号 ]",
  EndOfFileExpected: "顶层 JSON 值之后还有多余内容",
  InvalidCommentToken: "标准 JSON 不支持注释，可使用底部的“去除注释”",
  UnexpectedEndOfComment: "注释没有结束",
  UnexpectedEndOfString: "字符串没有结束",
  UnexpectedEndOfNumber: "数字没有结束",
  InvalidUnicode: "Unicode 转义格式不正确",
  InvalidEscapeCharacter: "字符串包含无效的转义字符",
  InvalidCharacter: "包含无效字符",
};

function diagnosticRange(offset, length, textLength) {
  if (length > 0) {
    return { from: Math.min(offset, textLength), to: Math.min(offset + length, textLength) };
  }
  if (offset < textLength) return { from: offset, to: offset + 1 };
  return { from: Math.max(0, textLength - 1), to: textLength };
}

function findDuplicateKeys(node, diagnostics) {
  if (node.type === "object") {
    const names = new Map();
    for (const property of node.children ?? []) {
      const key = property.children?.[0];
      if (key?.type !== "string" || typeof key.value !== "string") continue;
      if (!names.has(key.value)) names.set(key.value, []);
      names.get(key.value).push(key);
    }
    for (const [name, keys] of names) {
      if (keys.length < 2) continue;
      for (const key of keys) {
        diagnostics.push({
          from: key.offset,
          to: key.offset + key.length,
          severity: "warning",
          message: `对象中的属性名“${name}”重复（共 ${keys.length} 处）；解析时后一个值通常会覆盖前一个值`,
          source: "JSON",
        });
      }
    }
  }
  for (const child of node.children ?? []) findDuplicateKeys(child, diagnostics);
}

export function collectJsonDiagnostics(text) {
  if (!text.trim()) return [];

  const errors = [];
  const tree = parseTree(text, errors, { disallowComments: true, allowTrailingComma: false });
  const syntaxProblems = new Map();
  for (const error of errors) {
    const name = printParseErrorCode(error.error);
    const before = text.slice(0, error.offset).trimEnd();
    const trailingComma = (text[error.offset] === "}" || text[error.offset] === "]") && before.endsWith(",");
    const range = trailingComma
      ? { from: before.length - 1, to: before.length }
      : diagnosticRange(error.offset, error.length, text.length);
    const problem = {
      ...range,
      severity: "error",
      message: trailingComma ? "结尾有多余逗号" : (errorMessages[name] ?? "JSON 语法错误"),
      source: "JSON",
    };
    const key = `${range.from}:${range.to}`;
    if (!syntaxProblems.has(key)) syntaxProblems.set(key, problem);
  }
  const diagnostics = [...syntaxProblems.values()];

  if (tree) findDuplicateKeys(tree, diagnostics);
  diagnostics.sort((a, b) => a.from - b.from || (a.severity === "error" ? -1 : 1));
  return diagnostics;
}
