import { defineTypstEditorElement } from './element/typst-editor-element';

export { createTypstEditor, type TypstEditor, type TypstEditorOptions } from './editor/typst-editor';
export { TypstEditorElement, defineTypstEditorElement, type TypstEditorChangeDetail } from './element/typst-editor-element';

// Importing the package makes <typst-editor> available (no-op without a DOM).
defineTypstEditorElement();
