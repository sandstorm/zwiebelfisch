// @vitest-environment jsdom
// Tests for the caret between blocks (extensions/block-gaps/) beside the built-ins' blocks (tables,
// figures, lists) in a VisualEditor (integration: src/testing composes the built-ins).
import type { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { SourceRange, TypstDocument } from '../core/typst-document/typst-document';
import { createVisualEditor, type } from '../testing/testing';

// jsdom lacks layout; ProseMirror only needs these to exist (each line is then a text block's last).
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

function setup(text: string) {
  const parent = document.body.appendChild(document.createElement('div'));
  const doc = new TypstDocument(text);
  const view = createVisualEditor(parent, doc);
  const editable = parent.querySelector<HTMLElement>('.ProseMirror')!;
  const tiptap = (editable as HTMLElement & { editor: Editor }).editor;
  /** Presses `key` in the text; whether something took it (the browser does nothing then). */
  const press = (key: string) => !editable.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  /** The caret at source offset `offset`. */
  const caret = (offset: number) => view.reveal(SourceRange.of({ from: offset, to: offset }));
  const gaps = () => parent.querySelectorAll('.zwf-visual__block-gap').length;
  return { doc, view, tiptap, press, caret, gaps };
}

afterEach(() => document.body.replaceChildren());

describe('the caret between blocks', () => {
  it('has a gap after a table at the end of the document, where typing adds a paragraph', () => {
    const source = 'Text\n\n#table(columns: 2, [a], [b])\n';
    const { doc, press, caret, gaps, tiptap } = setup(source);
    caret(source.indexOf('[b]') + 2);
    expect(press('ArrowDown')).toBe(true);
    expect(gaps()).toBe(1);
    type(tiptap, 'z');
    expect(doc.text).toBe(`${source}\nz\n`);
  });

  it('has a gap after a figure with a caption at the end of the document', () => {
    const source = '#figure(table(columns: 1, [a]), caption: [Numbers])\n';
    const { press, caret, gaps, view } = setup(source);
    caret(source.indexOf('Numbers') + 'Numbers'.length);
    expect(press('ArrowDown')).toBe(true);
    expect(gaps()).toBe(1);
    expect(view.selection().from).toBe(source.length);
  });

  it('moves between cells of a table as before', () => {
    const source = '#table(columns: 2, [a], [b])\n\nAfter\n';
    const { press, caret, gaps } = setup(source);
    caret(source.indexOf('[a]') + 2);
    press('ArrowRight');
    expect(gaps()).toBe(0);
  });

  it('has a gap between a paragraph and a code block, where typing adds a paragraph', () => {
    const source = 'Text\n\n```js\nlet a\n```\n';
    const { doc, press, caret, gaps, view, tiptap } = setup(source);
    caret(4);
    expect(gaps()).toBe(0);
    expect(press('ArrowDown')).toBe(true);
    expect(gaps()).toBe(1);
    expect(press('ArrowDown')).toBe(true);
    expect(view.selection().from).toBe(source.indexOf('let a'));
    expect(press('ArrowUp')).toBe(true);
    expect(gaps()).toBe(1);
    type(tiptap, 'z');
    expect(doc.text).toBe('Text\n\nz\n\n```js\nlet a\n```\n');
  });

  it('takes ArrowDown at the end of the last code block, ArrowUp at the start of the first, before Tiptap (which makes a paragraph)', () => {
    const source = '```js\nlet a\n```\n';
    const { doc, press, caret, gaps, tiptap } = setup(source);
    caret(source.indexOf('let a') + 'let a'.length);
    expect(press('ArrowDown')).toBe(true);
    expect(gaps()).toBe(1);
    expect(tiptap.state.selection.toJSON()).toEqual({ type: 'blockGap', pos: tiptap.state.doc.content.size });
    caret(source.indexOf('let a'));
    expect(press('ArrowUp')).toBe(true);
    expect(tiptap.state.selection.toJSON()).toEqual({ type: 'blockGap', pos: 0 });
    expect(doc.text).toBe(source);
  });

  it('Delete at the gap before a code block goes into its code, selecting no node', () => {
    const source = 'Text\n\n```js\nlet a\n```\n';
    const { press, caret, gaps, view } = setup(source);
    caret(4);
    press('ArrowDown');
    expect(press('Delete')).toBe(true);
    expect(gaps()).toBe(0);
    expect(view.selection().from).toBe(source.indexOf('let a'));
  });

  it('leaves a code block on triple Enter at its end as before (Tiptap\'s exitCode): a paragraph after it', () => {
    const source = 'Text\n\n```js\nlet a\n```\n';
    const { doc, press, caret, gaps, tiptap } = setup(source);
    caret(source.indexOf('let a') + 'let a'.length);
    press('Enter');
    press('Enter');
    press('Enter');
    expect(gaps()).toBe(0);
    type(tiptap, 'z');
    expect(doc.text).toBe('Text\n\n```js\nlet a\n```\n\nz\n');
  });

  it('has no gap between two paragraphs nor at a list\'s items', () => {
    const { press, caret, gaps } = setup('One\n\nTwo\n\n- a\n- b\n');
    caret(3);
    press('ArrowRight');
    expect(gaps()).toBe(0);
    caret('One\n\nTwo\n\n- a'.length);
    press('ArrowRight');
    expect(gaps()).toBe(0);
  });

  it('has no gap between a list and a paragraph or another list: the arrows go on as ProseMirror does', () => {
    const source = 'One\n\n- a\n- b\n\n+ c\n\nTwo\n';
    const { press, caret, gaps } = setup(source);
    caret(3);
    expect(press('ArrowDown')).toBe(false);
    expect(gaps()).toBe(0);
    caret(source.indexOf('- a') + 2);
    expect(press('ArrowUp')).toBe(false);
    caret(source.indexOf('- b') + 3);
    expect(press('ArrowDown')).toBe(false);
    expect(gaps()).toBe(0);
    caret(source.indexOf('+ c') + 3);
    expect(press('ArrowDown')).toBe(false);
    expect(press('ArrowRight')).toBe(false);
    expect(gaps()).toBe(0);
  });

  it('has a gap between a list and a table, on the table\'s side as beside a paragraph', () => {
    const source = '- a\n- b\n\n#table(columns: 2, [x], [y])\n';
    const { doc, press, caret, gaps, tiptap } = setup(source);
    caret(source.indexOf('- b') + 3);
    expect(press('ArrowDown')).toBe(true);
    expect(gaps()).toBe(1);
    type(tiptap, 'z');
    expect(doc.text).toBe('- a\n- b\n\nz\n\n#table(columns: 2, [x], [y])\n');
  });
});
