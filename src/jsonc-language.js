import { continuedIndent, foldInside, foldNodeProp, indentNodeProp, LanguageSupport, LRLanguage } from "@codemirror/language";
import { styleTags, tags } from "@lezer/highlight";
import { parser } from "./jsonc-parser.js";

export const jsoncLanguage = LRLanguage.define({
  name: "jsonc",
  parser: parser.configure({
    props: [
      indentNodeProp.add({
        Object: continuedIndent({ except: /^\s*\}/ }),
        Array: continuedIndent({ except: /^\s*\]/ }),
      }),
      foldNodeProp.add({ "Object Array": foldInside }),
      styleTags({
        String: tags.string,
        PropertyName: tags.propertyName,
        Number: tags.number,
        "True False": tags.bool,
        Null: tags.null,
        LineComment: tags.lineComment,
        BlockComment: tags.blockComment,
        ", :": tags.separator,
        "[ ]": tags.squareBracket,
        "{ }": tags.brace,
      }),
    ],
  }),
  languageData: {
    closeBrackets: { brackets: ["[", "{", '"'] },
    indentOnInput: /^\s*[\}\]]$/,
    commentTokens: { line: "//", block: { open: "/*", close: "*/" } },
  },
});

export function jsonc() {
  return new LanguageSupport(jsoncLanguage);
}
