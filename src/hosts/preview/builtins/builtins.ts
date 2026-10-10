// The preview's built-in contributions, each in its own module so that it can move into its extension
// (docs/2026_10_10_extensions-architecture.md) by a file move. Entry of hosts/preview/builtins/.
// The toolbar items, for `Preview.registerToolbarItem` in this order (in brackets: the extension each one
// goes to): zoomControls, followCursor(options), pageNumber (preview-controls), pdfMenu (pdf-export).
export { followCursor, type FollowCursorOptions } from './follow-cursor';
export { pageNumber } from './page-number';
export { pdfMenu } from './pdf-menu';
export { zoomControls } from './zoom';
