import { createScanner, parse, printParseErrorCode, SyntaxKind } from "jsonc-parser";

export const jsoncParseOptions = { disallowComments: false, allowTrailingComma: false };

export const jsonErrorMessages = {
  InvalidSymbol: "无效字符，无法识别为 JSON 值",
  InvalidNumberFormat: "数字格式不正确",
  PropertyNameExpected: "这里需要双引号包裹的属性名",
  ValueExpected: "这里需要 JSON 值",
  ColonExpected: "属性名后缺少冒号 :",
  CommaExpected: "相邻项目之间缺少逗号 ,",
  CloseBraceExpected: "缺少右花括号 }",
  CloseBracketExpected: "缺少右方括号 ]",
  EndOfFileExpected: "顶层 JSON 值之后还有多余内容",
  UnexpectedEndOfComment: "注释没有结束",
  UnexpectedEndOfString: "字符串没有结束",
  UnexpectedEndOfNumber: "数字没有结束",
  InvalidUnicode: "Unicode 转义格式不正确",
  InvalidEscapeCharacter: "字符串包含无效的转义字符",
  InvalidCharacter: "包含无效字符",
};

export function parseJsonc(source) {
  const errors = [];
  const value = parse(source, errors, jsoncParseOptions);
  if (errors.length) {
    const error = errors[0];
    const lines = source.slice(0, error.offset).split(/\r\n|\r|\n/);
    const message = jsonErrorMessages[printParseErrorCode(error.error)] ?? "JSON 语法错误";
    throw new SyntaxError(`第 ${lines.length} 行，第 ${lines.at(-1).length + 1} 列：${message}`);
  }
  return value;
}

export function startsWithJsonContainer(source) {
  const token = createScanner(source, true).scan();
  return token === SyntaxKind.OpenBraceToken || token === SyntaxKind.OpenBracketToken;
}
