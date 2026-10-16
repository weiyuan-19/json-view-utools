import { createScanner, SyntaxKind } from "jsonc-parser";

function isObjectKeyPosition(text, position) {
  const scanner = createScanner(text);
  const stack = [];
  let token;
  while ((token = scanner.scan()) !== SyntaxKind.EOF) {
    const offset = scanner.getTokenOffset();
    if (offset >= position) break;
    if (offset + scanner.getTokenLength() > position) return false;
    if (token >= SyntaxKind.LineCommentTrivia && token <= SyntaxKind.Trivia) continue;
    const parent = stack.at(-1);
    if (token === SyntaxKind.OpenBraceToken) {
      stack.push({ type: "object", phase: "key" });
    } else if (token === SyntaxKind.OpenBracketToken) {
      stack.push({ type: "array" });
    } else if (token === SyntaxKind.CloseBraceToken || token === SyntaxKind.CloseBracketToken) {
      const closingType = token === SyntaxKind.CloseBraceToken ? "object" : "array";
      if (parent?.type !== closingType) continue;
      stack.pop();
      const container = stack.at(-1);
      if (container?.type === "object" && container.phase === "value") container.phase = "afterValue";
    } else if (parent?.type === "object") {
      if (token === SyntaxKind.CommaToken) parent.phase = "key";
      else if (token === SyntaxKind.ColonToken && parent.phase === "afterKey") parent.phase = "value";
      else if (token === SyntaxKind.StringLiteral) {
        if (parent.phase === "key") parent.phase = "afterKey";
        else if (parent.phase === "value") parent.phase = "afterValue";
      } else if ([SyntaxKind.NumericLiteral, SyntaxKind.TrueKeyword, SyntaxKind.FalseKeyword, SyntaxKind.NullKeyword].includes(token)) {
        if (parent.phase === "value") parent.phase = "afterValue";
      }
    }
  }
  const container = stack.at(-1);
  return container?.type === "object" && (container.phase === "key" || container.phase === "afterValue");
}

// Suggest the JSON spelling of a bare property name while it is being typed.
export function jsonPropertyCompletion(context) {
  const word = context.matchBefore(/[\p{L}\p{N}_$-]+/u);
  if (!word) return null;

  const text = context.state.doc.toString();
  if (text[word.from - 1] === '"' || text[word.from - 1] === "'") return null;
  if (/[\p{L}\p{N}_$-]/u.test(text[word.to] ?? "")) return null;
  if (!isObjectKeyPosition(text, word.from)) return null;

  const quoted = JSON.stringify(word.text);
  return {
    from: word.from,
    to: word.to,
    filter: false,
    options: [{ label: quoted, apply: quoted, type: "quote-key" }],
  };
}
