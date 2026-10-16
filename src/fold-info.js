import { ensureSyntaxTree, foldEffect, foldNodeProp } from "@codemirror/language";
import { jsoncLanguage } from "./jsonc-language.js";
import { parseJsonc } from "./jsonc.js";

export function foldAllRecursively(view) {
  const { state } = view;
  const tree = ensureSyntaxTree(state, state.doc.length, 100)
    ?? jsoncLanguage.parser.parse(state.doc.toString());
  const effects = [];

  tree.iterate({
    enter(cursor) {
      const fold = cursor.type.prop(foldNodeProp);
      const range = fold?.(cursor.node, state);
      if (range && range.to > state.doc.lineAt(range.from).to) {
        effects.push(foldEffect.of(range));
      }
    },
  });

  if (effects.length) view.dispatch({ effects });
  return effects.length > 0;
}

export function describeFold(state, range) {
  try {
    const value = parseJsonc(state.doc.sliceString(range.from - 1, range.to + 1));
    const count = Array.isArray(value) ? value.length : Object.keys(value).length;
    return `${count} 项`;
  } catch {
    const lines = state.doc.lineAt(range.to).number - state.doc.lineAt(range.from).number;
    return `${Math.max(1, lines)} 行`;
  }
}
