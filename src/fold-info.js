export function describeFold(state, range) {
  try {
    const value = JSON.parse(state.doc.sliceString(range.from - 1, range.to + 1));
    const count = Array.isArray(value) ? value.length : Object.keys(value).length;
    return `${count} 项`;
  } catch {
    const lines = state.doc.lineAt(range.to).number - state.doc.lineAt(range.from).number;
    return `${Math.max(1, lines)} 行`;
  }
}
