// @vitest-environment jsdom
// Tests for block-gaps.ts: the caret between blocks, with the host's minimum (paragraphs, raw blocks).
import { EditorView as CodeView } from '@codemirror/view';
import type { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Disposable } from '../../core/disposable/disposable';
import { SourceRange, TypstDocument } from '../../core/typst-document/typst-document';
import { VisualEditor, VisualEditorHost } from '../../hosts/visual-editor/visual-editor';
import type { ExtensionContext } from '../../hosts/workbench/workbench';
import { blockGaps } from './block-gaps';

// jsdom lacks layout; ProseMirror only needs these to exist.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

/** Two raw blocks (no spec models `#set`), then a paragraph. */
const SOURCE = '#set text(size: 12pt)\n\n#set par(justify: true)\n\nHello\n';
/** The source offset of the gap between the raw blocks: where the second one starts. */
const BETWEEN = SOURCE.indexOf('#set par');

function setup(text = SOURCE) {
  const parent = document.body.appendChild(document.createElement('div'));
  const doc = new TypstDocument(text);
  const visualEditor = new VisualEditorHost();
  const window = { registerStyleSheet: () => new Disposable(() => {}) };
  blockGaps().activate({ window, visualEditor, subscriptions: [] } as unknown as ExtensionContext);
  const view = new VisualEditor(parent, doc, visualEditor);
  const editable = parent.querySelector<HTMLElement>('.ProseMirror')!;
  const tiptap = (editable as HTMLElement & { editor: Editor }).editor;
  const press = (key: string) => !editable.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  const gap = () => parent.querySelector<HTMLElement>('.zwf-visual__block-gap');
  const box = (index: number) => CodeView.findFromDOM(parent.querySelectorAll<HTMLElement>('.zwf-visual__raw-block .cm-content')[index])!;
  /** The caret in the gap after the first raw block, as leaving its code downwards puts it. */
  const leaveFirstBox = () => {
    const code = box(0);
    code.dispatch({ selection: { anchor: code.state.doc.length } });
    code.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  };
  return { doc, view, tiptap, editable, press, gap, box, leaveFirstBox };
}

afterEach(() => document.body.replaceChildren());

describe('the caret between blocks', () => {
  it('is where leaving a raw box\'s code puts it, drawn as a line; its source offset, revealed, is the gap again', () => {
    const { view, gap, leaveFirstBox, tiptap } = setup();
    leaveFirstBox();
    expect(gap()).not.toBeNull();
    expect(view.selection()).toEqual({ from: BETWEEN, to: BETWEEN });
    tiptap.commands.setTextSelection(tiptap.state.doc.content.size - 1);
    expect(gap()).toBeNull();
    view.reveal(SourceRange.of({ from: BETWEEN, to: BETWEEN }));
    expect(gap()).not.toBeNull();
  });

  it('an arrow key at a gap goes into the raw box after it, then out again onto the gap', () => {
    const { press, gap, box, leaveFirstBox } = setup();
    box(1).dispatch({ selection: { anchor: 5 } });
    leaveFirstBox();
    expect(press('ArrowDown')).toBe(true);
    expect(box(1).state.selection.main.head).toBe(0);
    leaveFirstBox();
    expect(press('ArrowUp')).toBe(true);
    expect(box(0).state.selection.main.head).toBe(box(0).state.doc.length);
    expect(gap()).not.toBeNull();
  });

  it('goes from the end of a paragraph before a raw box to the gap, and back', () => {
    const source = 'Hello\n\n#set text(size: 12pt)\n';
    const { view, press, gap } = setup(source);
    view.reveal(SourceRange.of({ from: 5, to: 5 }));
    expect(press('ArrowRight')).toBe(true);
    expect(gap()).not.toBeNull();
    expect(press('ArrowLeft')).toBe(true);
    expect(gap()).toBeNull();
    expect(view.selection().from).toBe(5);
  });

  it('typing at a gap adds a paragraph there; one undo takes it back, the caret in its gap again', () => {
    const { doc, tiptap, gap, leaveFirstBox } = setup();
    leaveFirstBox();
    tiptap.view.someProp('handleTextInput', (f) => f(tiptap.view, tiptap.state.selection.from, tiptap.state.selection.to, 'x', () => tiptap.state.tr));
    expect(doc.text).toBe(SOURCE.replace('\n\n#set par', '\n\nx\n\n#set par'));
    tiptap.commands.undo();
    expect(doc.text).toBe(SOURCE);
    expect(gap()).not.toBeNull();
  });

  it('Backspace selects the block before, Delete the block after; a second Backspace deletes it', () => {
    const { doc, tiptap, press, leaveFirstBox } = setup();
    leaveFirstBox();
    expect(press('Delete')).toBe(true);
    expect(tiptap.state.selection.toJSON()).toEqual({ type: 'node', anchor: 1 });
    leaveFirstBox();
    expect(press('Backspace')).toBe(true);
    expect(tiptap.state.selection.toJSON()).toEqual({ type: 'node', anchor: 0 });
    press('Backspace');
    expect(doc.text).toBe('#set par(justify: true)\n\nHello\n');
  });

  it('a paste at a gap goes in there (without the clipboard extension: as ProseMirror pastes text, its characters escaped)', () => {
    const { doc, editable, leaveFirstBox } = setup();
    leaveFirstBox();
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', { value: { getData: (type: string) => (type === 'text/plain' ? 'Pasted *text*' : ''), types: ['text/plain'], files: [] } });
    editable.dispatchEvent(paste);
    expect(doc.text).toBe(SOURCE.replace('\n\n#set par', '\n\nPasted \\*text\\*\n\n#set par'));
  });

  it('a click into the space between two raw blocks puts the caret there', () => {
    const { view, tiptap, editable, gap } = setup();
    // laid out as 20px blocks 10px apart, from the top
    const tops = new Map<unknown, number>();
    tiptap.state.doc.forEach((_node, pos, index) => tops.set(tiptap.view.nodeDOM(pos), index * 30));
    const measure = Element.prototype.getBoundingClientRect;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const top = tops.get(this);
      return top === undefined ? measure.call(this) : new DOMRect(0, top, 100, 20);
    });
    vi.spyOn(tiptap.view, 'posAtCoords').mockReturnValue({ pos: 0, inside: -1 });
    try {
      for (const type of ['mousedown', 'mouseup']) editable.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 50, clientY: 25 }));
    } finally {
      vi.restoreAllMocks();
    }
    expect(gap()).not.toBeNull();
    expect(view.selection().from).toBe(BETWEEN);
  });

  it('there is none between two paragraphs', () => {
    const { view, press, gap } = setup('One\n\nTwo\n');
    view.reveal(SourceRange.of({ from: 3, to: 3 }));
    expect(press('ArrowRight')).toBe(false);
    expect(gap()).toBeNull();
  });
});
