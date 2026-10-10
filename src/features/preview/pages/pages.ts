// The preview's pages: placeholders that get their SVG only near the viewport (PageList), and the
// pure geometry around them: overlay boxes, visibility and the current page, zoom steps, change
// bars, other users' markers, and snippets (a page cut down to the boxes of a source range).
export { changeBars, drawnRanges } from './change-bars';
export { isInside, mostVisible, percentOfPage } from './geometry';
export { PageList } from './page-list';
export { presenceMarkers } from './presence-markers';
export { snippet, type Snippet } from './snippet';
export { stepZoom, zoomLabel, type Zoom } from './zoom';
