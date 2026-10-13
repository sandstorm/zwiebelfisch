import { Extension as TiptapExtension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import type { Extension } from '../../hosts/workbench/workbench';
import { wordProcessorHtml } from './visual-editor/word-processor-html';

/**
 * Text pasted from a word processor (Microsoft Word, Google Docs, LibreOffice) goes into the Visual editor as its
 * author formatted it: Word's lists as lists, not paragraphs after a `·`; no empty paragraphs, no bold headings, no
 * `\` lines for Google Docs' empty lines; text in a monospace font as code (visual-editor/word-processor-html.ts).
 * Its HTML is cleaned before the Visual editor reads it with its HTML rules (ProseMirror's `transformPastedHTML`), so
 * the paste's HTML edit (`typst.html`) is the cleaned one. See docs/20_features/01_wysiwyg-editing.typ (Copy and paste).
 */
export function wordProcessors(): Extension {
  return {
    id: 'wordProcessors',
    activate({ visualEditor, subscriptions }) {
      subscriptions.push(visualEditor.registerTiptapExtension(() => WordProcessorPaste));
    },
  };
}

const WordProcessorPaste = TiptapExtension.create({
  name: 'typstWordProcessorPaste',
  addProseMirrorPlugins() {
    return [new Plugin({ props: { transformPastedHTML: wordProcessorHtml } })];
  },
});
