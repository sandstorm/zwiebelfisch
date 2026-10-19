import { Extension as TiptapExtension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import type { Extension } from '../../hosts/workbench/workbench';
import { wordProcessorHtml } from './visual-editor/word-processor-html';

/**
 * Text pasted from a word processor (Microsoft Word, Google Docs, LibreOffice) goes into the Visual editor as its
 * author formatted it: Word's lists as lists, not paragraphs after a `·`; no empty paragraphs, no bold headings, no
 * `\` lines for Google Docs' empty lines; text in a monospace font as code.
 *
 * The cleaning happens before the Visual editor reads the HTML, so the paste's HTML edit (`typst.html`) is the
 * cleaned one too.
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
