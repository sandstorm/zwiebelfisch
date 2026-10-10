// jsdom lacks layout; ProseMirror and CodeMirror only need these to exist.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();
Element.prototype.scrollIntoView = () => {};
