// @vitest-environment jsdom
// Tests for the caret between blocks (the Visual editor's block gaps) beside styled blocks: two block styles ending in
// a code block (the docs' `example`), with the built-ins (src/testing).
import type { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  const gaps = () => parent.querySelectorAll('.zwf-visual__block-gap').length;
  return { doc, view, tiptap, editable, press, caret, gaps };
}

afterEach(() => document.body.replaceChildren());

describe('the caret between two block styles ending in code', () => {
  const endOfFirst = TWO_EXAMPLES.indexOf('Different color') + 'Different color'.length;
  const between = TWO_EXAMPLES.indexOf('\n]\n') + 2;

  it('goes from the end of the first one\'s code to the gap after the code, then to the gap after the block style, there shown as a line', () => {
    const { view, press, caret, gaps, tiptap } = setup(TWO_EXAMPLES);
    caret(endOfFirst);
    expect(press('ArrowDown')).toBe(true);
    expect(gaps()).toBe(1);
    expect(tiptap.state.selection.$head.depth).toBe(1);
    expect(press('ArrowDown')).toBe(true);
    expect(gaps()).toBe(1);
    expect(view.selection()).toEqual({ from: between, to: between });
    expect(tiptap.state.selection.$head.depth).toBe(0);
  });

  it('typing there adds a paragraph between them, the Typst unchanged otherwise', () => {
    const { doc, press, caret, tiptap } = setup(TWO_EXAMPLES);
    caret(endOfFirst);
    press('ArrowDown');
    press('ArrowDown');
    type(tiptap, 'x');
    expect(doc.text).toBe(TWO_EXAMPLES.replace('```\n]\n\n#example[', '```\n]\n\nx\n\n#example['));
  });

  it('Enter there adds an empty paragraph to write in', () => {
    const { doc, press, caret, tiptap } = setup(TWO_EXAMPLES);
    caret(endOfFirst);
    press('ArrowDown');
    press('ArrowDown');
    expect(press('Enter')).toBe(true);
    type(tiptap, 'y');
    expect(doc.text).toBe(TWO_EXAMPLES.replace('```\n]\n\n#example[', '```\n]\n\ny\n\n#example['));
  });

  it('Backspace there selects the first block style, a second one deletes it', () => {
    const { doc, press, caret, tiptap } = setup(TWO_EXAMPLES);
    caret(endOfFirst);
    press('ArrowDown');
    press('ArrowDown');
    expect(press('Backspace')).toBe(true);
    expect(tiptap.state.selection.toJSON()).toMatchObject({ type: 'node', anchor: tiptap.state.doc.child(0).nodeSize });
    expect(doc.text).toBe(TWO_EXAMPLES);
    press('Backspace');
    expect(doc.text).not.toContain('Different color');
    expect(doc.text).toContain('#example[\n  ```typ');
  });

  it('ArrowDown on goes to the gap before the second one\'s code, into it; ArrowUp back the same stops', () => {
    const { view, press, caret, gaps, tiptap } = setup(TWO_EXAMPLES);
    caret(endOfFirst);
    press('ArrowDown');
    press('ArrowDown');
    press('ArrowDown');
    expect(tiptap.state.selection.toJSON()).toMatchObject({ type: 'blockGap', pos: tiptap.state.doc.child(0).nodeSize + tiptap.state.doc.child(1).nodeSize + 1 });
    press('ArrowDown');
    expect(gaps()).toBe(0);
    expect(view.selection().from).toBe(TWO_EXAMPLES.indexOf('#set text(font'));
    press('ArrowUp');
    press('ArrowUp');
    expect(view.selection().from).toBe(between);
    press('ArrowUp');
    expect(gaps()).toBe(1);
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
    press('ArrowDown');
    doc.setText(`Before, changed.${TWO_EXAMPLES.slice('Before.'.length)}`, 'source');
    expect(gaps()).toBe(1);
    expect(view.selection().from).toBe(between + ', changed'.length);
  });
});

describe('the caret between two code blocks in a block style', () => {
  /** The report: one example holding two code blocks in a row. */
  const TWO_CODE_BLOCKS = [
    '#example[```typ',
    'Default text',
    '',
    '#set text(font: "Gabarito", size: 20pt)',
    'Big text',
    '',
    '#set text(fill: blue)',
    'Different color',
    '```',
    '',
    '```typ',
    '  #set text(font: "Gabarito", size: 11pt, lang: "en")',
    '  #set par(justify: true)',
    '',
    "  Typst compiles a document in milliseconds, so the preview follows every keystroke. The font is one of the project's files: any `.ttf` or `.otf` uploaded counts.",
    '  ```',
    ']',
  ].join('\n');
  const endOfFirst = TWO_CODE_BLOCKS.indexOf('Different color') + 'Different color'.length;
  const between = TWO_CODE_BLOCKS.indexOf('```\n\n```typ') + '```'.length;
  const startOfSecond = TWO_CODE_BLOCKS.indexOf('#set text(font: "Gabarito", size: 11pt');
  const endOfSecond = TWO_CODE_BLOCKS.indexOf('counts.') + 'counts.'.length;

  it('ArrowDown goes one stop at a time: the gap between them, the second\'s code, the gap after it in the example, the gap after the example', () => {
    const { doc, view, press, caret, gaps, tiptap } = setup(TWO_CODE_BLOCKS);
    caret(endOfFirst);
    expect(press('ArrowDown')).toBe(true);
    expect(gaps()).toBe(1);
    expect(view.selection().from).toBe(between);
    expect(tiptap.state.selection.$head.depth).toBe(1);
    expect(press('ArrowDown')).toBe(true);
    expect(gaps()).toBe(0);
    expect(view.selection().from).toBe(startOfSecond);
    caret(endOfSecond);
    expect(press('ArrowDown')).toBe(true);
    expect(gaps()).toBe(1);
    expect(tiptap.state.selection.$head.depth).toBe(1);
    expect(press('ArrowDown')).toBe(true);
    expect(gaps()).toBe(1);
    expect(tiptap.state.selection.$head.depth).toBe(0);
    expect(doc.text).toBe(TWO_CODE_BLOCKS);
  });

  it('ArrowUp mirrors it: from the second\'s code to the gap between, into the first\'s code, then before it in the example and before the example', () => {
    const { doc, view, press, caret, gaps, tiptap } = setup(TWO_CODE_BLOCKS);
    caret(startOfSecond);
    expect(press('ArrowUp')).toBe(true);
    expect(view.selection().from).toBe(between);
    expect(press('ArrowUp')).toBe(true);
    expect(view.selection().from).toBe(endOfFirst);
    caret(TWO_CODE_BLOCKS.indexOf('Default text'));
    expect(press('ArrowLeft')).toBe(true);
    expect(gaps()).toBe(1);
    expect(tiptap.state.selection.toJSON()).toEqual({ type: 'blockGap', pos: 1 });
    expect(press('ArrowLeft')).toBe(true);
    expect(tiptap.state.selection.toJSON()).toEqual({ type: 'blockGap', pos: 0 });
    expect(doc.text).toBe(TWO_CODE_BLOCKS);
  });

  it('typing "x" in the gap between them adds a paragraph there, inside the example, the Typst unchanged otherwise', () => {
    const { doc, press, caret, tiptap } = setup(TWO_CODE_BLOCKS);
    caret(endOfFirst);
    press('ArrowDown');
    type(tiptap, 'x');
    expect(doc.text).toBe(TWO_CODE_BLOCKS.replace('```\n\n```typ', '```\n\nx\n\n```typ'));
  });

  it('a caret revealed at the gap\'s offset (from the Source editor) is the gap between them', () => {
    const { caret, gaps, tiptap } = setup(TWO_CODE_BLOCKS);
    caret(between);
    expect(gaps()).toBe(1);
    expect(tiptap.state.selection.$head.depth).toBe(1);
  });

  it('a click into the space between them (in the example) puts the caret there', () => {
    const { view, tiptap, editable, gaps } = setup(TWO_CODE_BLOCKS);
    // the example's two code blocks laid out 20px high, 10px apart
    const example = tiptap.state.doc.child(0);
    const tops = new Map<unknown, number>([[tiptap.view.nodeDOM(1), 0], [tiptap.view.nodeDOM(1 + example.child(0).nodeSize), 30]]);
    const measure = Element.prototype.getBoundingClientRect;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const top = tops.get(this);
      return top === undefined ? measure.call(this) : new DOMRect(0, top, 100, 20);
    });
    vi.spyOn(tiptap.view, 'posAtCoords').mockReturnValue({ pos: 1, inside: 0 });
    const target = editable.querySelector('.zwf-styles__block')!;
    try {
      for (const type of ['mousedown', 'mouseup']) target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 50, clientY: 25 }));
    } finally {
      vi.restoreAllMocks();
    }
    expect(gaps()).toBe(1);
    expect(view.selection().from).toBe(between);
  });

  it('Backspace in the gap between them goes to the end of the first\'s code', () => {
    const { doc, view, press, caret, gaps } = setup(TWO_CODE_BLOCKS);
    caret(endOfFirst);
    press('ArrowDown');
    expect(press('Backspace')).toBe(true);
    expect(gaps()).toBe(0);
    expect(view.selection().from).toBe(endOfFirst);
    expect(doc.text).toBe(TWO_CODE_BLOCKS);
  });
});

describe('the caret beside a list in a block style', () => {
  const source = 'Before.\n\n#example[\n  Intro.\n\n  - a\n  - b\n]\n\nAfter.\n';
  const endOfLast = source.indexOf('- b') + 3;

  it('goes from the end of the last item of a list ending a block style to the gap after the block style', () => {
    const { view, press, caret, gaps, tiptap } = setup(source);
    caret(endOfLast);
    expect(press('ArrowDown')).toBe(true);
    expect(gaps()).toBe(1);
    expect(tiptap.state.selection.toJSON()).toMatchObject({ type: 'blockGap', pos: tiptap.state.doc.child(0).nodeSize + tiptap.state.doc.child(1).nodeSize });
    expect(view.selection().from).toBe(source.indexOf('\n]\n') + 2);
    expect(press('ArrowUp')).toBe(true);
    expect(view.selection().from).toBe(endOfLast);
  });

  it('has no gap between the list and the paragraph before it in the block style', () => {
    const { press, caret, gaps } = setup(source);
    caret(source.indexOf('Intro.') + 'Intro.'.length);
    expect(press('ArrowDown')).toBe(false);
    expect(gaps()).toBe(0);
  });
});
