// @vitest-environment jsdom
// Tests for the caret between blocks (the Visual editor's block gaps) beside styled blocks: two block styles ending in
// a code block (the docs' `example`), with the built-ins (src/testing).
import type { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { EventEmitter } from '../../../core/event-emitter/event-emitter';
import { ProjectPath } from '../../../core/paths/paths';
import { SourceRange, TypstDocument } from '../../../core/typst-document/typst-document';
import { createVisualEditor, type } from '../../../testing/testing';
import type { ProjectStyles } from '../model/typst-style-index';
import { customStyles } from './visual-editor';

// jsdom lacks layout; ProseMirror only needs these to exist (each line is then a text block's last).
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

const EXAMPLE: ProjectStyles = {
  styles: () => [{ name: 'example', kind: 'block', label: 'Example', path: ProjectPath.of('/template.typ') }],
  onDidChange: new EventEmitter<void>().event,
  calculateImportChange: () => null,
};

/** The two examples of the report: a block style ending in a code block, twice, between paragraphs. */
const TWO_EXAMPLES = [
  'Before.',
  '',
  '#example[```typ',
  'Default text',
  '',
  '#set text(fill: blue)',
  'Different color',
  '```',
  ']',
  '',
  '#example[',
  '  ```typ',
  '  #set text(font: "Gabarito", size: 11pt, lang: "en")',
  '  Typst compiles a document in milliseconds.',
  '  ```',
  ']',
  '',
  'After.',
  '',
].join('\n');

function setup(text: string) {
  const parent = document.body.appendChild(document.createElement('div'));
  const doc = new TypstDocument(text);
  const view = createVisualEditor(parent, doc, { contributions: [customStyles({ styles: EXAMPLE, create: () => {} })] });
  const editable = parent.querySelector<HTMLElement>('.ProseMirror')!;
  const tiptap = (editable as HTMLElement & { editor: Editor }).editor;
  /** Presses `key` in the text; whether something took it (the browser does nothing then). */
  const press = (key: string) => !editable.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  /** The caret at source offset `offset`. */
  const caret = (offset: number) => view.reveal(SourceRange.of({ from: offset, to: offset }));
  const gaps = () => parent.querySelectorAll('.typst-visual__block-gap').length;
  return { doc, view, tiptap, press, caret, gaps };
}

afterEach(() => document.body.replaceChildren());

describe('the caret between two block styles ending in code', () => {
  const endOfFirst = TWO_EXAMPLES.indexOf('Different color') + 'Different color'.length;
  const between = TWO_EXAMPLES.indexOf('\n]\n') + 2;

  it('goes from the end of the first one\'s code to the gap after it, there shown as a line', () => {
    const { view, press, caret, gaps, tiptap } = setup(TWO_EXAMPLES);
    caret(endOfFirst);
    expect(press('ArrowDown')).toBe(true);
    expect(gaps()).toBe(1);
    expect(view.selection()).toEqual({ from: between, to: between });
    expect(tiptap.state.selection.$head.depth).toBe(0);
  });

  it('typing there adds a paragraph between them, the Typst unchanged otherwise', () => {
    const { doc, press, caret, tiptap } = setup(TWO_EXAMPLES);
    caret(endOfFirst);
    press('ArrowDown');
    type(tiptap, 'x');
    expect(doc.text).toBe(TWO_EXAMPLES.replace('```\n]\n\n#example[', '```\n]\n\nx\n\n#example['));
  });

  it('Enter there adds an empty paragraph to write in', () => {
    const { doc, press, caret, tiptap } = setup(TWO_EXAMPLES);
    caret(endOfFirst);
    press('ArrowDown');
    expect(press('Enter')).toBe(true);
    type(tiptap, 'y');
    expect(doc.text).toBe(TWO_EXAMPLES.replace('```\n]\n\n#example[', '```\n]\n\ny\n\n#example['));
  });

  it('Backspace there selects the first block style, a second one deletes it', () => {
    const { doc, press, caret, tiptap } = setup(TWO_EXAMPLES);
    caret(endOfFirst);
    press('ArrowDown');
    expect(press('Backspace')).toBe(true);
    expect(tiptap.state.selection.toJSON()).toMatchObject({ type: 'node', anchor: tiptap.state.doc.child(0).nodeSize });
    expect(doc.text).toBe(TWO_EXAMPLES);
    press('Backspace');
    expect(doc.text).not.toContain('Different color');
    expect(doc.text).toContain('#example[\n  ```typ');
  });

  it('ArrowDown again goes into the second one\'s code, ArrowUp from there back to the gap, then into the first\'s code', () => {
    const { view, press, caret, gaps } = setup(TWO_EXAMPLES);
    caret(endOfFirst);
    press('ArrowDown');
    press('ArrowDown');
    expect(gaps()).toBe(0);
    expect(view.selection().from).toBe(TWO_EXAMPLES.indexOf('#set text(font'));
    press('ArrowUp');
    expect(view.selection().from).toBe(between);
    press('ArrowUp');
    expect(view.selection().from).toBe(endOfFirst);
  });

  it('a caret revealed between them (from the Source editor) is the gap', () => {
    const { caret, gaps, view } = setup(TWO_EXAMPLES);
    caret(between);
    expect(gaps()).toBe(1);
    expect(view.selection().from).toBe(between);
    caret(between + 2);
    expect(gaps()).toBe(0);
  });

  it('stays in its gap while the text changes elsewhere', () => {
    const { doc, view, press, caret, gaps } = setup(TWO_EXAMPLES);
    caret(endOfFirst);
    press('ArrowDown');
    doc.setText(`Before, changed.${TWO_EXAMPLES.slice('Before.'.length)}`, 'source');
    expect(gaps()).toBe(1);
    expect(view.selection().from).toBe(between + ', changed'.length);
  });
});
