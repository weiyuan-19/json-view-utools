import "./styles.css";
import { acceptCompletion, autocompletion } from "@codemirror/autocomplete";
import { indentWithTab } from "@codemirror/commands";
import { json } from "@codemirror/lang-json";
import { getSearchQuery, openSearchPanel, search, SearchQuery, searchPanelOpen, setSearchQuery } from "@codemirror/search";
import { bracketMatching, codeFolding, ensureSyntaxTree, foldAll, foldGutter, HighlightStyle, indentUnit, syntaxHighlighting, syntaxTree, unfoldAll } from "@codemirror/language";
import { forEachDiagnostic, linter } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import { Decoration, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, placeholder, ViewPlugin } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { minimalSetup } from "codemirror";
import { describeFold } from "./fold-info.js";
import { collectJsonDiagnostics } from "./diagnostics.js";
import { jsonPropertyCompletion } from "./completion.js";
import { decodedItemChanges, escapedJsonItems, luaJsonItemChanges } from "./inner-unescape.js";
import { overviewTop } from "./overview.js";
import { activeJsonScope, bracketJsonScope, guidesForLine } from "./scope-guides.js";
import { collectSearchMatches, createJsonSearchPanel } from "./search-panel.js";
import { escapeJson, formatJson, formatPastedJson, minifyJson, stripJsonComments, unescapeJson } from "./transform.js";

const status = document.querySelector("#status");
const copyButton = document.querySelector("#copy");
const problemSummary = document.querySelector("#problem-summary");
const problemOverview = document.querySelector("#problem-overview");
const decodedPanel = document.querySelector("#decoded-panel");
const decodedTitle = document.querySelector("#decoded-title");
const decodedItems = document.querySelector("#decoded-items");
const replaceAllDecoded = document.querySelector("#replace-all-decoded");
const replaceAllLuaJson = document.querySelector("#replace-all-lua-json");
const problemPanel = document.querySelector("#problem-panel");
const problemPosition = document.querySelector("#problem-position");
const problemList = document.querySelector("#problem-list");
let currentProblems = [];
let selectedProblem = 0;
let statusTimeout;
let pendingDecodedItems = [];
let lastProblemListKey = "";
const overviewMarkers = new Map();

function syncOverviewMarkers(markers) {
  const visible = new Set();
  for (const marker of markers) {
    visible.add(marker.key);
    let element = overviewMarkers.get(marker.key);
    if (!element) {
      element = document.createElement(marker.problemIndex == null ? "div" : "button");
      if (marker.problemIndex != null) {
        element.type = "button";
        const index = marker.problemIndex;
        element.addEventListener("click", () => goToProblem(index));
      }
      overviewMarkers.set(marker.key, element);
      problemOverview.append(element);
    }
    if (element.className !== marker.className) element.className = marker.className;
    const top = `${marker.top}px`;
    const height = `${marker.height}px`;
    if (element.style.top !== top) element.style.top = top;
    if (element.style.height !== height) element.style.height = height;
    if (element.title !== marker.title) element.title = marker.title;
    if (marker.problemIndex != null && element.getAttribute("aria-label") !== marker.title) {
      element.setAttribute("aria-label", marker.title);
    }
  }
  for (const [key, element] of overviewMarkers) {
    if (visible.has(key)) continue;
    element.remove();
    overviewMarkers.delete(key);
  }
}

function hideStatus() {
  clearTimeout(statusTimeout);
  status.classList.remove("is-visible");
  status.textContent = "";
}

function showStatus(message, type = "neutral") {
  hideStatus();
  status.textContent = message;
  status.dataset.type = type;
  status.classList.add("is-visible");
  statusTimeout = setTimeout(hideStatus, 3000);
}

const jsonColors = HighlightStyle.define([
  { tag: tags.propertyName, color: "var(--key)" },
  { tag: tags.string, color: "var(--string)" },
  { tag: tags.number, color: "var(--number)" },
  { tag: [tags.bool, tags.null], color: "var(--keyword)" },
  { tag: tags.comment, color: "var(--comment)" },
]);

const selectedSpace = Decoration.mark({ class: "cm-selected-space" });
const selectedWhitespace = ViewPlugin.fromClass(class {
  constructor(view) {
    this.decorations = this.build(view);
  }

  update(update) {
    if (update.docChanged || update.selectionSet || update.viewportChanged) {
      this.decorations = this.build(update.view);
    }
  }

  build(view) {
    const marks = [];
    for (const selection of view.state.selection.ranges) {
      if (selection.empty) continue;
      for (const visible of view.visibleRanges) {
        const from = Math.max(selection.from, visible.from);
        const to = Math.min(selection.to, visible.to);
        if (from >= to) continue;
        const text = view.state.doc.sliceString(from, to);
        for (let index = 0; index < text.length; index += 1) {
          if (text[index] === " " || text[index] === "\t") {
            marks.push(selectedSpace.range(from + index, from + index + 1));
          }
        }
      }
    }
    return Decoration.set(marks, true);
  }
}, { decorations: (plugin) => plugin.decorations });

const scopeBracket = Decoration.mark({ class: "cm-active-scope-bracket" });
function scopeIdentity(scope) {
  return scope ? `${scope.from}:${scope.to}` : "";
}

const scopeGuides = ViewPlugin.fromClass(class {
  constructor(view) {
    const active = activeJsonScope(view.state);
    this.activeScope = scopeIdentity(active);
    this.decorations = this.build(view, active);
  }

  update(update) {
    const active = activeJsonScope(update.state);
    const nextScope = scopeIdentity(active);
    if (update.docChanged || update.viewportChanged || nextScope !== this.activeScope ||
        syntaxTree(update.startState) !== syntaxTree(update.state)) {
      this.activeScope = nextScope;
      this.decorations = this.build(update.view, active);
    }
  }

  build(view, active) {
    const state = view.state;
    const decorations = [];

    for (const visible of view.visibleRanges) {
      let position = state.doc.lineAt(visible.from).from;
      while (position <= visible.to && position <= state.doc.length) {
        const line = state.doc.lineAt(position);
        const guides = guidesForLine(state, line, active);
        if (guides.length) {
          const images = guides.map(({ active: isActive }) => {
            const color = isActive ? "var(--guide-active)" : "var(--guide)";
            return `linear-gradient(${color}, ${color})`;
          });
          const positions = guides.map(({ column }) => `calc(var(--line-padding) + ${column}ch) top`);
          const sizes = guides.map(() => "1px 100%");
          decorations.push(Decoration.line({ attributes: {
            class: "cm-indent-guides",
            style: `background-image: ${images.join(", ")}; background-position: ${positions.join(", ")}; background-size: ${sizes.join(", ")}; background-repeat: no-repeat;`,
          } }).range(line.from));
        }
        position = line.to + 1;
      }
    }

    if (active && active.to - active.from >= 2) {
      const open = state.doc.sliceString(active.from, active.from + 1);
      const close = state.doc.sliceString(active.to - 1, active.to);
      if ((open === "{" && close === "}") || (open === "[" && close === "]")) {
        decorations.push(scopeBracket.range(active.from, active.from + 1));
        decorations.push(scopeBracket.range(active.to - 1, active.to));
      }
    }

    return Decoration.set(decorations, true);
  }
}, { decorations: (plugin) => plugin.decorations });

function foldIcon(open) {
  const element = document.createElement("span");
  element.className = "cm-fold-icon";
  element.title = open ? "折叠" : "展开";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", open ? "M3 5.5 8 10.5 13 5.5" : "M5.5 3 10.5 8 5.5 13");
  svg.append(path);
  element.append(svg);
  return element;
}

function renderProblems(view) {
  const diagnostics = [];
  forEachDiagnostic(view.state, (problem, from) => diagnostics.push({ ...problem, from }));
  currentProblems = diagnostics;
  selectedProblem = Math.min(selectedProblem, Math.max(0, diagnostics.length - 1));
  const errors = diagnostics.filter((problem) => problem.severity === "error").length;
  const warnings = diagnostics.filter((problem) => problem.severity === "warning").length;
  if (problemSummary.hidden !== (diagnostics.length === 0)) {
    problemSummary.hidden = diagnostics.length === 0;
  }
  const summary = `${errors ? `错误 ${errors}` : ""}${errors && warnings ? " · " : ""}${warnings ? `警告 ${warnings}` : ""}`;
  if (problemSummary.textContent !== summary) problemSummary.textContent = summary;
  problemSummary.classList.toggle("has-errors", errors > 0);
  if (diagnostics.length === 0 && !problemPanel.hidden) problemPanel.hidden = true;

  if (!problemPanel.hidden) {
    const position = `${selectedProblem + 1} / ${diagnostics.length} 个问题 · ${errors} 个错误 · ${warnings} 个警告`;
    if (problemPosition.textContent !== position) problemPosition.textContent = position;
    const listKey = JSON.stringify([selectedProblem, diagnostics.map((problem) => [
      problem.from, problem.to, problem.severity, problem.message,
      view.state.doc.lineAt(problem.from).number,
    ])]);
    if (listKey !== lastProblemListKey) {
      const items = document.createDocumentFragment();
      diagnostics.forEach((problem, index) => {
        const line = view.state.doc.lineAt(problem.from).number;
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.className = `problem-list-item is-${problem.severity}`;
        button.classList.toggle("is-selected", index === selectedProblem);
        button.textContent = `第 ${line} 行 · ${problem.message}`;
        button.addEventListener("click", () => goToProblem(index));
        item.append(button);
        items.append(item);
      });
      problemList.replaceChildren(items);
      lastProblemListKey = listKey;
    }
  }
  const viewportHeight = view.scrollDOM.clientHeight;
  const contentHeight = view.contentHeight;
  const paddingTop = view.documentPadding.top;
  const trackTop = view.scrollDOM.getBoundingClientRect().top - problemOverview.parentElement.getBoundingClientRect().top;
  const overviewOffset = `${trackTop}px`;
  const summaryOffset = `${trackTop + 10}px`;
  if (problemOverview.style.top !== overviewOffset) problemOverview.style.top = overviewOffset;
  if (problemSummary.style.top !== summaryOffset) problemSummary.style.top = summaryOffset;
  const overviewHeight = `${viewportHeight}px`;
  if (problemOverview.style.height !== overviewHeight) problemOverview.style.height = overviewHeight;
  const markerTop = (position, height, edge = "middle") => {
    const line = view.lineBlockAt(position);
    const offset = edge === "start" ? 0 : edge === "end" ? line.height : line.height / 2;
    return overviewTop(paddingTop + line.top + offset, contentHeight, viewportHeight, height);
  };
  const markerLineBounds = (position) => {
    const line = view.lineBlockAt(position);
    const top = overviewTop(paddingTop + line.top, contentHeight, viewportHeight, 2);
    const bottom = overviewTop(paddingTop + line.bottom, contentHeight, viewportHeight, 2);
    return { top: (top + bottom) / 2, height: Math.max(3, bottom - top) };
  };

  const markers = [];
  const activeScope = bracketJsonScope(view.state);
  if (activeScope) {
    for (const [edge, position, lineNumber] of [
      ["start", activeScope.from, activeScope.openLine],
      ["end", activeScope.to - 1, activeScope.closeLine],
    ]) {
      const bounds = markerLineBounds(position);
      markers.push({
        key: `scope-${edge}`,
        className: `problem-marker is-scope-${edge}`,
        top: bounds.top,
        height: bounds.height,
        title: `当前所在结构${edge === "start" ? "开始" : "结束"}：第 ${lineNumber} 行`,
      });
    }
  }
  const currentPosition = view.state.selection.main.head;
  const currentLine = view.state.doc.lineAt(currentPosition).number;
  markers.push({
    key: "current",
    className: "problem-marker is-current",
    top: markerTop(currentPosition, 2, "start"),
    height: 2,
    title: `当前光标：第 ${currentLine} 行`,
  });

  if (searchPanelOpen(view.state)) {
    const selected = view.state.selection.main;
    const searchLines = new Map();
    for (const match of collectSearchMatches(view.state)) {
      const line = view.state.doc.lineAt(match.from).number;
      const isSelected = match.from === selected.from && match.to === selected.to;
      searchLines.set(line, (searchLines.get(line) ?? false) || isSelected);
    }
    for (const [lineNumber, isSelected] of searchLines) {
      const line = view.state.doc.line(lineNumber);
      const bounds = markerLineBounds(line.from);
      markers.push({
        key: `search-${lineNumber}`,
        className: `problem-marker is-search${isSelected ? " is-search-selected" : ""}`,
        top: bounds.top,
        height: bounds.height,
        title: `搜索命中：第 ${lineNumber} 行`,
      });
    }
  }

  diagnostics.forEach((problem, index) => {
    const line = view.state.doc.lineAt(problem.from).number;
    const bounds = markerLineBounds(problem.from);
    markers.push({
      key: `problem-${index}`,
      problemIndex: index,
      className: `problem-marker is-${problem.severity}`,
      top: bounds.top,
      height: bounds.height,
      title: `第 ${line} 行：${problem.message}`,
    });
  });
  syncOverviewMarkers(markers);
}

function goToProblem(index) {
  if (!currentProblems.length) return;
  selectedProblem = (index + currentProblems.length) % currentProblems.length;
  const problem = currentProblems[selectedProblem];
  unfoldAll(editor);
  editor.dispatch({ selection: { anchor: problem.from }, scrollIntoView: true });
  editor.focus();
  renderProblems(editor);
}

const editor = new EditorView({
  parent: document.querySelector("#editor"),
  extensions: [
    minimalSetup,
    lineNumbers(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    bracketMatching(),
    foldGutter({ markerDOM: foldIcon }),
    codeFolding({
      preparePlaceholder: describeFold,
      placeholderDOM(_view, onclick, description) {
        const element = document.createElement("span");
        element.className = "cm-foldPlaceholder";
        element.textContent = `… ${description}`;
        element.title = "点击展开";
        element.setAttribute("aria-label", `已折叠 ${description}，点击展开`);
        element.addEventListener("click", onclick);
        return element;
      },
    }),
    json(),
    search({ top: true, createPanel: createJsonSearchPanel }),
    autocompletion({ override: [jsonPropertyCompletion] }),
    linter((view) => collectJsonDiagnostics(view.state.doc.toString()), { delay: 250 }),
    syntaxHighlighting(jsonColors),
    placeholder("在这里粘贴或输入 JSON…"),
    selectedWhitespace,
    scopeGuides,
    EditorState.tabSize.of(4),
    indentUnit.of("    "),
    keymap.of([{ key: "Tab", run: acceptCompletion }, indentWithTab]),
    EditorView.editorAttributes.of((view) =>
      view.state.selection.ranges.some((range) => !range.empty) ? { class: "cm-has-selection" } : null),
    EditorView.contentAttributes.of({
      "aria-label": "JSON 编辑器",
      "aria-describedby": "status",
      spellcheck: "false",
      autocapitalize: "off",
    }),
    EditorView.updateListener.of((update) => {
      renderProblems(update.view);
      if (update.docChanged) {
        copyButton.disabled = update.state.doc.length === 0;
        pendingDecodedItems = [];
        decodedPanel.hidden = true;
        hideStatus();
      }
    }),
    EditorView.domEventHandlers({
      paste(event, view) {
        const pasted = event.clipboardData?.getData("text/plain");
        if (!pasted) return false;
        const result = formatPastedJson(pasted);
        if (!result.formatted) return false;
        event.preventDefault();
        view.dispatch(view.state.replaceSelection(result.text));
        showStatus("粘贴内容已按 4 个空格自动格式化", "success");
        return true;
      },
    }),
  ],
});

document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "f") {
    event.preventDefault();
    const selection = editor.state.selection.main;
    const selectedText = editor.hasFocus && !selection.empty
      ? editor.state.doc.sliceString(selection.from, selection.to) : "";
    const previous = getSearchQuery(editor.state);
    openSearchPanel(editor);
    if (selectedText) {
      editor.dispatch({ effects: setSearchQuery.of(new SearchQuery({
        search: selectedText.replace(/\n/g, "\\n"),
        replace: previous.replace,
        caseSensitive: previous.caseSensitive,
        wholeWord: previous.wholeWord,
        regexp: false,
        test: previous.test,
      })) });
    }
    const searchInput = editor.dom.querySelector('[main-field]');
    searchInput?.setSelectionRange(searchInput.value.length, searchInput.value.length);
  }
}, true);

problemSummary.addEventListener("click", () => {
  problemPanel.hidden = !problemPanel.hidden;
  renderProblems(editor);
});
document.querySelector("#previous-problem").addEventListener("click", () => goToProblem(selectedProblem - 1));
document.querySelector("#next-problem").addEventListener("click", () => goToProblem(selectedProblem + 1));
document.querySelector("#close-problems").addEventListener("click", () => { problemPanel.hidden = true; renderProblems(editor); editor.focus(); });

function editorText() {
  return editor.state.doc.toString();
}

function setEditorValue(value) {
  unfoldAll(editor);
  editor.dispatch({
    changes: { from: 0, to: editor.state.doc.length, insert: value },
    selection: { anchor: 0 },
    scrollIntoView: true,
  });
  editor.focus();
}

function runTransform(transform, successMessage) {
  const source = editorText();
  if (!source.trim()) {
    showStatus("请先输入 JSON 内容", "error");
    editor.focus();
    return;
  }

  try {
    setEditorValue(transform(source));
    showStatus(successMessage, "success");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showStatus(error instanceof SyntaxError ? `JSON 格式错误：${message}` : message, "error");
    editor.focus();
  }
}

document.querySelector("#format").addEventListener("click", () => runTransform(formatJson, "已按 4 个空格格式化"));
function showDecodedItems(items) {
  pendingDecodedItems = items;
  decodedTitle.textContent = `去转义结果${items.length > 1 ? `（${items.length} 项）` : ""}`;
  replaceAllDecoded.hidden = items.length < 2;
  replaceAllLuaJson.hidden = items.length < 2;
  const fragment = document.createDocumentFragment();
  items.forEach((item, index) => {
    const section = document.createElement("section");
    section.className = "decoded-item";
    const header = document.createElement("div");
    header.className = "decoded-item-header";
    const name = document.createElement("strong");
    const path = item.path.reduce((label, part) =>
      typeof part === "number" ? `${label}[${part}]` : `${label}${label ? "." : ""}${part}`, "");
    name.textContent = `${path || "当前字符串"} · 第 ${editor.state.doc.lineAt(item.from).number} 行`;
    const actions = document.createElement("div");
    actions.className = "decoded-panel-controls";
    for (const [action, label] of [["copy", "复制"], ["replace", "替换"], ["lua-json", "Lua转Json并替换"]]) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.action = action;
      button.dataset.index = String(index);
      button.textContent = label;
      button.setAttribute("aria-label", `${name.textContent}：${label}`);
      actions.append(button);
    }
    const result = document.createElement("pre");
    result.textContent = item.decoded;
    header.append(name, actions);
    section.append(header, result);
    fragment.append(section);
  });
  decodedItems.replaceChildren(fragment);
  decodedPanel.hidden = false;
}

document.querySelector("#unescape").addEventListener("click", () => {
  try {
    const source = editorText();
    if (!/^[\s]*[\[{]/.test(source)) {
      runTransform(unescapeJson, "已去除转义字符");
      return;
    }
    const items = escapedJsonItems(source);
    if (!items.length) {
      showStatus("编辑区没有带转义的字符串值", "error");
      return;
    }
    showDecodedItems(items);
  } catch (error) {
    showStatus(error.message, "error");
  }
});
document.querySelector("#close-decoded").addEventListener("click", () => {
  pendingDecodedItems = [];
  decodedPanel.hidden = true;
  editor.focus();
});
replaceAllDecoded.addEventListener("click", () => {
  if (pendingDecodedItems.length < 2) return;
  const count = pendingDecodedItems.length;
  editor.dispatch({ changes: decodedItemChanges(pendingDecodedItems) });
  editor.focus();
  showStatus(`已在原文中替换 ${count} 项去转义结果`, "success");
});
replaceAllLuaJson.addEventListener("click", () => {
  if (pendingDecodedItems.length < 2) return;
  try {
    const changes = luaJsonItemChanges(pendingDecodedItems, editorText());
    editor.dispatch({ changes });
    editor.focus();
    showStatus(`已将 ${changes.length} 项 Lua 表转为 JSON 并替换`, "success");
  } catch (error) {
    showStatus(`Lua 转 JSON 失败，未替换任何内容：${error.message}`, "error");
  }
});
decodedItems.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button || !decodedItems.contains(button)) return;
  const item = pendingDecodedItems[Number(button.dataset.index)];
  if (!item) return;
  if (button.dataset.action === "replace") {
    editor.dispatch({
      changes: { from: item.from, to: item.to, insert: item.decoded },
      selection: { anchor: item.from + item.decoded.length },
      scrollIntoView: true,
    });
    editor.focus();
    showStatus("已在原文对应位置替换去转义结果", "success");
    return;
  }
  if (button.dataset.action === "lua-json") {
    try {
      const [{ from, to, insert }] = luaJsonItemChanges([item], editorText());
      editor.dispatch({
        changes: { from, to, insert },
        selection: { anchor: from + insert.length },
        scrollIntoView: true,
      });
      editor.focus();
      showStatus("已将 Lua 表转为 JSON 并替换原文对应位置", "success");
    } catch (error) {
      showStatus(`Lua 转 JSON 失败：${error.message}`, "error");
    }
    return;
  }
  try {
    if (window.utools?.copyText) {
      if (window.utools.copyText(item.decoded) === false) throw new Error("复制失败");
    } else {
      await navigator.clipboard.writeText(item.decoded);
    }
    showStatus("已复制去转义结果", "success");
  } catch {
    showStatus("复制失败，请在结果中手动选择文本", "error");
  }
});
document.querySelector("#strip-comments").addEventListener("click", () => runTransform(stripJsonComments, "已去掉注释"));
document.querySelector("#minify").addEventListener("click", () => runTransform(minifyJson, "已压缩 JSON"));
document.querySelector("#escape").addEventListener("click", () => runTransform(escapeJson, "已压缩并转义"));
document.querySelector("#fold-all").addEventListener("click", () => {
  ensureSyntaxTree(editor.state, editor.state.doc.length, 100);
  showStatus(foldAll(editor) ? "已折叠全部，可点击行号旁箭头或省略号展开" : "当前没有可折叠的内容");
});
document.querySelector("#unfold-all").addEventListener("click", () => {
  showStatus(unfoldAll(editor) ? "已展开全部" : "当前没有折叠的内容");
});

copyButton.addEventListener("click", async () => {
  const value = editorText();
  try {
    if (window.utools?.copyText) {
      if (window.utools.copyText(value) === false) throw new Error("复制失败");
    } else {
      await navigator.clipboard.writeText(value);
    }
    showStatus("已复制全部内容", "success");
  } catch {
    editor.dispatch({ selection: { anchor: 0, head: editor.state.doc.length } });
    editor.focus();
    showStatus("已选中内容，请按 Ctrl/Cmd+C 复制", "error");
  }
});

function loadAction(action) {
  if ((action.type === "regex" || action.type === "over") && typeof action.payload === "string") {
    const result = formatPastedJson(action.payload);
    setEditorValue(result.text);
    showStatus(result.formatted ? "已载入文本并按 4 个空格格式化" : "已载入文本，可直接编辑");
    return;
  }
  if ((action.type === "files" || action.type === "file") && Array.isArray(action.payload)) {
    const file = action.payload[0];
    setEditorValue("");
    if (file?.isFile && /\.json$/i.test(file.name) && window.jsonView?.readFile) {
      try {
        setEditorValue(window.jsonView.readFile(file.path));
        showStatus(`已载入 ${file.name}，修改仅在编辑器中生效`);
      } catch (error) {
        showStatus(`读取文件失败：${error.message}`, "error");
      }
    } else {
      showStatus("未找到可读取的 JSON 文件", "error");
    }
    return;
  }
  setEditorValue("");
  hideStatus();
}

if (window.utools?.onPluginEnter) window.utools.onPluginEnter(loadAction);

copyButton.disabled = true;
editor.focus();
new ResizeObserver(() => renderProblems(editor)).observe(editor.scrollDOM);
requestAnimationFrame(() => renderProblems(editor));
