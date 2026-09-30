export function overviewTop(documentY, contentHeight, viewportHeight, markerHeight = 8) {
  if (viewportHeight <= 0) return 0;
  const scale = Math.min(1, viewportHeight / Math.max(1, contentHeight));
  const halfMarker = Math.min(markerHeight / 2, viewportHeight / 2);
  return Math.max(halfMarker, Math.min(documentY * scale, viewportHeight - halfMarker));
}
