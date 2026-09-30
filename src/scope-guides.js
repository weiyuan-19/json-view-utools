import { syntaxTree } from "@codemirror/language";
import { countColumn } from "@codemirror/state";

export function jsonScopesAt(state, position, side = -1) {
  const scopes = [];
  const tree = syntaxTree(state);
  const offset = Math.max(0, Math.min(position, state.doc.length));

  for (let node = tree.resolveInner(offset, side); node; node = node.parent) {
    if (node.name !== "Object" && node.name !== "Array") continue;
    const openLine = state.doc.lineAt(node.from);
    const closeLine = state.doc.lineAt(node.to);
    const leading = /^\s*/.exec(openLine.text)[0];
    scopes.push({
      from: node.from,
      to: node.to,
      column: countColumn(leading, state.tabSize),
      openLine: openLine.number,
      closeLine: closeLine.number,
    });
  }

  return scopes;
}

export function activeJsonScope(state) {
  const position = state.selection.main.head;
  const next = state.doc.sliceString(position, position + 1);
  return jsonScopesAt(state, position, next === "{" || next === "[" ? 1 : -1)[0] || null;
}

export function bracketJsonScope(state) {
  const position = state.selection.main.head;
  for (const offset of [position, position - 1]) {
    if (offset < 0 || offset >= state.doc.length) continue;
    const bracket = state.doc.sliceString(offset, offset + 1);
    const opening = bracket === "{" || bracket === "[";
    if (!opening && bracket !== "}" && bracket !== "]") continue;
    const scope = jsonScopesAt(state, offset, opening ? 1 : -1)
      .find((item) => opening ? item.from === offset : item.to - 1 === offset);
    if (scope) return scope;
  }
  return null;
}

export function guidesForLine(state, line, activeScope) {
  const leading = /^\s*/.exec(line.text)[0];
  const position = Math.min(line.to, line.from + leading.length);
  const scopes = jsonScopesAt(state, position, 1);
  const guides = [];
  const seen = new Set();

  for (const scope of scopes) {
    if (line.number <= scope.openLine || line.number >= scope.closeLine || seen.has(scope.column)) continue;
    seen.add(scope.column);
    guides.push({
      column: scope.column,
      active: activeScope?.from === scope.from && activeScope?.to === scope.to,
    });
  }

  return guides.sort((left, right) => left.column - right.column);
}
