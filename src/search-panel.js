import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  SearchQuery,
  setSearchQuery,
} from "@codemirror/search";

const maxCount = 10000;
const icons = {
  expand: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7 4 6 6-6 6"/></svg>',
  collapse: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4 7 6 6 6-6"/></svg>',
  previous: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 17V3M4 9l6-6 6 6"/></svg>',
  next: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3v14m-6-6 6 6 6-6"/></svg>',
  selection: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2 4h16M2 9h12M2 14h16"/></svg>',
  close: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 4l12 12M16 4 4 16"/></svg>',
  replace: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 2v6m-3-3 3 3 3-3M9 3h8"/><rect x="5" y="11" width="12" height="7" rx="1"/><path d="M8 14.5h6"/></svg>',
  replaceAll: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 2v5M2 5l2 2 2-2M9 2v5M7 5l2 2 2-2"/><rect x="4" y="10" width="10" height="7" rx="1"/><path d="M7 13.5h4M15 11h2v7h-8"/></svg>',
};

export function collectSearchMatches(state, limit = maxCount) {
  const query = getSearchQuery(state);
  if (!query.valid) return [];
  const matches = [];
  const cursor = query.getCursor(state);
  for (let match = cursor.next(); !match.done && matches.length < limit; match = cursor.next()) {
    matches.push(match.value);
  }
  return matches;
}

export function replacementForMatch(query, match, original, preserveCase = false) {
  const replaceText = query.replace.replace(/\\([nrt\\])/g, (_full, letter) =>
    ({ n: "\n", r: "\r", t: "\t", "\\": "\\" })[letter]);
  const expanded = query.regexp
    ? replaceText.replace(/\$([$&]|\d+)/g, (full, group) => {
      if (group === "$") return "$";
      if (group === "&") return match.match?.[0] ?? original;
      return match.match?.[Number(group)] ?? full;
    })
    : replaceText;
  if (!preserveCase) return expanded;
  const letters = original.match(/[A-Za-z]+/g)?.join("") ?? "";
  if (letters && letters === letters.toUpperCase()) return expanded.toUpperCase();
  if (letters && letters === letters.toLowerCase()) return expanded.toLowerCase();
  if (/^[A-Z][a-z]+$/.test(letters)) return expanded.charAt(0).toUpperCase() + expanded.slice(1).toLowerCase();
  return expanded;
}

function makeButton(label, title, onClick, className = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.title = title;
  button.setAttribute("aria-label", title);
  button.addEventListener("click", onClick);
  return button;
}

function makeIconButton(icon, title, onClick) {
  const button = makeButton("", title, onClick, "json-search-icon");
  button.innerHTML = icons[icon];
  return button;
}

function makeInput(placeholder, value) {
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  input.placeholder = placeholder;
  input.setAttribute("aria-label", placeholder);
  input.autocomplete = "off";
  input.spellcheck = false;
  return input;
}

class JsonSearchPanel {
  constructor(view) {
    this.view = view;
    this.onKeydown = this.onKeydown.bind(this);
    this.scope = null;
    this.scopeFilter = (_match, _state, from, to) =>
      !this.scope || (from >= this.scope.from && to <= this.scope.to);
    const query = getSearchQuery(view.state);
    this.searchField = makeInput("查找", query.search);
    this.searchField.setAttribute("main-field", "true");
    this.replaceField = makeInput("替换", query.replace);

    this.dom = document.createElement("div");
    this.dom.className = "json-search-panel";
    const resizer = document.createElement("div");
    resizer.className = "json-search-resizer";
    resizer.setAttribute("role", "separator");
    resizer.setAttribute("aria-label", "拖动调整搜索框宽度");
    resizer.setAttribute("aria-orientation", "vertical");
    resizer.addEventListener("pointerdown", (event) => this.startResize(event));
    const content = document.createElement("div");
    content.className = "json-search-content";
    const firstRow = document.createElement("div");
    firstRow.className = "json-search-row";
    const secondRow = document.createElement("div");
    secondRow.className = "json-search-row json-search-replace-row";
    secondRow.hidden = true;

    this.expandButton = makeIconButton("expand", "展开替换", () => this.toggleReplace());
    this.expandButton.classList.add("json-search-expand");
    this.expandButton.setAttribute("aria-expanded", "false");
    const searchBox = document.createElement("div");
    searchBox.className = "json-search-input-box";
    this.searchField.addEventListener("input", () => this.commit(true));
    this.caseButton = this.optionButton("Aa", "区分大小写", query.caseSensitive);
    this.wordButton = this.optionButton("", "全字匹配", query.wholeWord);
    this.wordButton.innerHTML = '<span class="json-search-word-icon">Ab</span>';
    this.regexButton = this.optionButton("", "使用正则表达式", query.regexp);
    this.regexButton.innerHTML = '<span class="json-search-regex-icon">.*</span>';
    searchBox.append(this.searchField, this.caseButton, this.wordButton, this.regexButton);

    this.count = document.createElement("span");
    this.count.className = "json-search-count";
    this.count.setAttribute("aria-live", "polite");
    this.previousButton = makeIconButton("previous", "上一个结果", () => this.navigate(findPrevious));
    this.nextButton = makeIconButton("next", "下一个结果", () => this.navigate(findNext));
    this.scopeButton = makeIconButton("selection", "在选中内容中查找", () => this.toggleScope());
    this.scopeButton.setAttribute("aria-pressed", "false");
    const close = makeIconButton("close", "关闭搜索", () => this.close());
    firstRow.append(searchBox, this.count, this.previousButton, this.nextButton, this.scopeButton, close);

    const replaceBox = document.createElement("div");
    replaceBox.className = "json-search-input-box";
    this.replaceField.addEventListener("input", () => this.commit(false));
    this.preserveCaseButton = makeButton("AB", "替换时保留大小写", () => {
      this.preserveCaseButton.setAttribute("aria-pressed", String(this.preserveCaseButton.getAttribute("aria-pressed") !== "true"));
    }, "json-search-option");
    this.preserveCaseButton.setAttribute("aria-pressed", "false");
    replaceBox.append(this.replaceField, this.preserveCaseButton);
    const replaceActions = document.createElement("div");
    replaceActions.className = "json-search-replace-actions";
    this.replaceOneButton = makeIconButton("replace", "替换当前结果", () => this.replace(false));
    this.replaceAllButton = makeIconButton("replaceAll", "替换所有结果", () => this.replace(true));
    replaceActions.append(this.replaceOneButton, this.replaceAllButton);
    secondRow.append(replaceBox, replaceActions);
    content.append(firstRow, secondRow);
    this.dom.append(resizer, this.expandButton, content);
    this.replaceRow = secondRow;
    this.refresh();
  }

  optionButton(label, title, checked) {
    const button = makeButton(label, title, () => {
      button.setAttribute("aria-pressed", String(button.getAttribute("aria-pressed") !== "true"));
      this.commit(true, true);
    }, "json-search-option");
    button.setAttribute("aria-pressed", String(checked));
    return button;
  }

  startResize(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    this.stopResize?.();
    const panel = this.dom.parentElement;
    if (!panel) return;
    const startWidth = panel.getBoundingClientRect().width;
    const startX = event.clientX;
    const pointerId = event.pointerId;
    const move = (moveEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const maximum = Math.max(0, this.view.dom.clientWidth - 42);
      const minimum = Math.min(340, maximum);
      panel.style.width = `${Math.max(minimum, Math.min(maximum, startWidth + startX - moveEvent.clientX))}px`;
    };
    const stop = (endEvent) => {
      if (endEvent?.pointerId != null && endEvent.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      this.stopResize = null;
    };
    this.stopResize = stop;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  }

  commit(navigate, force = false) {
    const query = new SearchQuery({
      search: this.searchField.value,
      replace: this.replaceField.value,
      caseSensitive: this.caseButton.getAttribute("aria-pressed") === "true",
      wholeWord: this.wordButton.getAttribute("aria-pressed") === "true",
      regexp: this.regexButton.getAttribute("aria-pressed") === "true",
      test: this.scopeFilter,
    });
    if (force || !query.eq(getSearchQuery(this.view.state))) {
      const start = this.view.state.selection.main.from;
      this.view.dispatch({
        effects: setSearchQuery.of(query),
        ...(navigate ? { selection: { anchor: start } } : {}),
      });
      if (navigate && query.valid) this.navigate(findNext);
    }
    this.refresh();
  }

  refresh() {
    const query = getSearchQuery(this.view.state);
    const matches = collectSearchMatches(this.view.state);
    const selection = this.view.state.selection.main;
    const selected = matches.findIndex(({ from, to }) => from === selection.from && to === selection.to);
    this.count.textContent = this.searchField.value && !query.valid
      ? "正则无效"
      : !matches.length ? "无结果" : `${selected + 1 || 0} of ${matches.length}${matches.length === maxCount ? "+" : ""}`;
    this.dom.classList.toggle("has-active-match", selected >= 0);
    this.dom.classList.toggle("has-invalid-query", !!this.searchField.value && !query.valid);
    this.scopeButton.disabled = !this.scope && selection.empty;
    this.previousButton.disabled = this.nextButton.disabled = !matches.length;
    this.replaceOneButton.disabled = this.replaceAllButton.disabled = !matches.length || this.view.state.readOnly;
  }

  navigate(command) {
    const focused = document.activeElement === this.searchField;
    const start = focused ? this.searchField.selectionStart : null;
    const end = focused ? this.searchField.selectionEnd : null;
    const direction = focused ? this.searchField.selectionDirection : "none";
    command(this.view);
    if (focused && document.activeElement === this.searchField && start != null && end != null) {
      this.searchField.setSelectionRange(start, end, direction);
    }
    this.refresh();
  }

  onKeydown(event) {
    if (event.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.close();
    } else if (event.key === "Enter" && event.target === this.searchField &&
               !event.altKey && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      event.stopPropagation();
      this.navigate(event.shiftKey ? findPrevious : findNext);
    }
  }

  replace(all) {
    if (this.preserveCaseButton.getAttribute("aria-pressed") === "true") {
      this.replacePreservingCase(all);
    } else {
      (all ? replaceAll : replaceNext)(this.view);
    }
    this.refresh();
  }

  replacePreservingCase(all) {
    const state = this.view.state;
    const query = getSearchQuery(state);
    const matches = collectSearchMatches(state, all ? Number.MAX_SAFE_INTEGER : maxCount)
      .filter((match) => match.precise);
    if (!matches.length) return;
    const selection = state.selection.main;
    const selected = matches.find((match) => match.from === selection.from && match.to === selection.to);
    const targets = all ? matches : [selected ?? matches.find((match) => match.from >= selection.to) ?? matches[0]];
    const changes = targets.map((match) => {
      const original = state.doc.sliceString(match.from, match.to);
      return { from: match.from, to: match.to, insert: replacementForMatch(query, match, original, true) };
    });
    this.view.dispatch({ changes, userEvent: all ? "input.replace.all" : "input.replace" });
    if (!all) findNext(this.view);
  }

  toggleReplace() {
    this.replaceRow.hidden = !this.replaceRow.hidden;
    const expanded = !this.replaceRow.hidden;
    this.expandButton.innerHTML = icons[expanded ? "collapse" : "expand"];
    this.expandButton.setAttribute("aria-expanded", String(expanded));
    this.expandButton.title = expanded ? "收起替换" : "展开替换";
    this.expandButton.setAttribute("aria-label", this.expandButton.title);
    this.dom.closest(".editor-workspace")?.classList.toggle("search-expanded", expanded);
  }

  toggleScope() {
    if (this.scope) {
      this.scope = null;
    } else {
      const { from, to } = this.view.state.selection.main;
      if (from === to) return;
      this.scope = { from, to };
    }
    this.scopeButton.setAttribute("aria-pressed", String(!!this.scope));
    this.commit(false, true);
  }

  update(update) {
    const query = getSearchQuery(update.state);
    if (this.searchField.value !== query.search || this.replaceField.value !== query.replace ||
        this.caseButton.getAttribute("aria-pressed") !== String(query.caseSensitive) ||
        this.wordButton.getAttribute("aria-pressed") !== String(query.wholeWord) ||
        this.regexButton.getAttribute("aria-pressed") !== String(query.regexp)) {
      this.searchField.value = query.search;
      this.replaceField.value = query.replace;
      this.caseButton.setAttribute("aria-pressed", String(query.caseSensitive));
      this.wordButton.setAttribute("aria-pressed", String(query.wholeWord));
      this.regexButton.setAttribute("aria-pressed", String(query.regexp));
    }
    if (this.scope && query.test !== this.scopeFilter) {
      this.scope = null;
      this.scopeButton.setAttribute("aria-pressed", "false");
    }
    if (update.docChanged && this.scope) {
      this.scope = {
        from: update.changes.mapPos(this.scope.from, -1),
        to: update.changes.mapPos(this.scope.to, 1),
      };
    }
    this.refresh();
  }

  mount() {
    this.dom.closest(".editor-workspace")?.classList.add("search-open");
    document.addEventListener("keydown", this.onKeydown, true);
    this.searchField.focus();
    this.searchField.setSelectionRange(this.searchField.value.length, this.searchField.value.length);
  }

  close() {
    if (this.scope) {
      this.scope = null;
      this.commit(false, true);
    }
    closeSearchPanel(this.view);
  }

  destroy() {
    this.stopResize?.();
    document.removeEventListener("keydown", this.onKeydown, true);
    this.dom.closest(".editor-workspace")?.classList.remove("search-open", "search-expanded");
  }

  get top() { return true; }
}

export function createJsonSearchPanel(view) {
  return new JsonSearchPanel(view);
}
