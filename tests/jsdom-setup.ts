// Vitest setup file (vite.config.ts `test.setupFiles`): stubs for the layout APIs jsdom lacks.
// Runs before every unit test file; does nothing in the node environment.
if (typeof Range !== 'undefined') {
  // jsdom lacks layout; ProseMirror and CodeMirror only need these to exist.
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Element.prototype.scrollIntoView = () => {};
  // No layout, so no position under the mouse (ProseMirror's posAtCoords then returns null).
  Document.prototype.elementFromPoint = () => null;
}
