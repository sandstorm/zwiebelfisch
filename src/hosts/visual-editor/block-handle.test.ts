// @vitest-environment jsdom
// Tests for block-handle.ts, with the host's own nodes: paragraphs and raw boxes (list items: the lists extension's tests).
import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TypstDocument } from '../../core/typst-document/typst-document';
import { VisualEditor, VisualEditorHost } from './visual-editor';

function setup(text: string) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const doc = new TypstDocument(text);
  new VisualEditor(parent, doc, VisualEditorHost.from([]));
  const tiptap = (parent.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor;
  return { doc, tiptap, view: tiptap.view, parent };
}

/**
 * The grip shown beside the block at `pos` of `view`, as the pointer moving beside it shows it. jsdom has no layout:
 * for that move, each node's DOM is laid out by its positions (top 10px per position, as tall as its size).
 */
function grip(view: EditorView, pos: number): HTMLElement {
  const laidOut = new Map<unknown, DOMRect>();
  view.state.doc.descendants((node, at) => void laidOut.set(view.nodeDOM(at), new DOMRect(0, at * 10, 100, node.nodeSize * 10)));
  const measure = Element.prototype.getBoundingClientRect;
  const rects = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return laidOut.get(this) ?? measure.call(this);
  });
  view.dom.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientY: pos * 10 }));
  rects.mockRestore();
  return view.dom.parentElement!.querySelector<HTMLElement>('.zwf-visual__block-handle')!;
}

/** The browser starting a drag of `source` (jsdom has no drag events: a plain event, a stand-in `dataTransfer`). */
function dragStart(source: Element) {
  source.dispatchEvent(dragEvent('dragstart'));
}

/** What was dragged dropped on `target`, at position `pos` of `view` (jsdom cannot tell it from coordinates). */
function drop(view: EditorView, target: Element, pos: number) {
  const posAtCoords = vi.spyOn(view, 'posAtCoords').mockReturnValue({ pos, inside: -1 });
  target.dispatchEvent(dragEvent('drop'));
  posAtCoords.mockRestore();
}

function dragEvent(type: string): Event {
  const data = new Map<string, string>();
  const dataTransfer = {
    files: [],
    effectAllowed: 'all',
    clearData: () => data.clear(),
    setData: (f: string, v: string) => data.set(f, v),
    getData: (f: string) => data.get(f) ?? '',
    setDragImage: () => {},
  };
  return Object.assign(new Event(type, { bubbles: true, cancelable: true }), { dataTransfer, clientX: 0, clientY: 0 });
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('the block handle', () => {
  it('shows beside the block at the pointer\'s height, the first one above all blocks', () => {
    const { view } = setup('Hello\n\n#let a = 1\n\nWorld\n');
    const box = view.state.doc.child(0).nodeSize;
    const handle = grip(view, box);
    expect(handle.hidden).toBe(false);
    expect(handle.draggable).toBe(true);
    dragStart(handle);
    expect(view.dragging?.slice.content.firstChild?.type.name).toBe('rawBlock');
    expect(view.state.selection instanceof NodeSelection && view.state.selection.from).toBe(box);
    dragStart(grip(view, -5));
    expect(view.dragging?.slice.content.firstChild?.textContent).toBe('Hello');
  });

  it('hides when the pointer leaves the text, on a key press and after an edit; never shows read-only', () => {
    const { view, tiptap, parent } = setup('Hello\n\nWorld\n');
    const handle = grip(view, 0);
    view.dom.dispatchEvent(new MouseEvent('mouseleave', { relatedTarget: handle }));
    expect(handle.hidden).toBe(false);
    view.dom.dispatchEvent(new MouseEvent('mouseleave', { relatedTarget: parent }));
    expect(handle.hidden).toBe(true);
    grip(view, 0);
    view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(handle.hidden).toBe(true);
    grip(view, 0);
    tiptap.commands.insertContentAt(1, 'Oh ');
    expect(handle.hidden).toBe(true);
    tiptap.setEditable(false);
    expect(grip(view, 0).hidden).toBe(true);
  });

  it('dragged elsewhere, moves its block there, the Typst verbatim, in one undo step', () => {
    const text = 'A *bold*   start.\n\n#set text(size: 12pt)\n\nEnd\n';
    const { doc, tiptap, view } = setup(text);
    dragStart(grip(view, 0));
    expect(view.dragging?.move).toBe(true);
    drop(view, view.dom, view.state.doc.content.size);
    expect(doc.text).toBe('#set text(size: 12pt)\n\nEnd\n\nA *bold*   start.\n');
    tiptap.commands.undo();
    expect(doc.text).toBe(text);
  });

  it('moves a raw box by its handle', () => {
    const { doc, view } = setup('#set text(size: 12pt)\n\nHello\n\nWorld\n');
    dragStart(grip(view, 0));
    drop(view, view.dom.querySelectorAll('p')[1], view.state.doc.content.size);
    expect(doc.text).toBe('Hello\n\nWorld\n\n#set text(size: 12pt)\n');
  });

  it('dropped on a raw box\'s code, a block lands beside the box, not in its code', () => {
    const { doc, view } = setup('#let a = 1\n\n#let b = 2\n\nHello\n');
    dragStart(grip(view, view.state.doc.content.size - 7));
    const second = view.dom.querySelectorAll('.zwf-visual__raw-block')[1];
    drop(view, second.querySelector('.cm-content')!, view.state.doc.child(0).nodeSize);
    expect(doc.text).toBe('#let a = 1\n\nHello\n\n#let b = 2\n');
  });

  it('a drag in a raw box\'s code stays in the code (text, not a block)', () => {
    const { view } = setup('#let a = 1\n\nHello\n');
    dragStart(view.dom.querySelector('.zwf-visual__raw-block .cm-content')!);
    expect(view.dragging).toBeNull();
  });

  it('clicked, selects its block', () => {
    const { view } = setup('Hello\n\nWorld\n');
    const second = view.state.doc.child(0).nodeSize;
    grip(view, second).click();
    const { selection } = view.state;
    expect(selection instanceof NodeSelection && selection.from).toBe(second);
  });

  it('a drag that ends without a drop in the editor moves nothing', () => {
    vi.useFakeTimers();
    try {
      const { view } = setup('Hello\n\nWorld\n');
      const handle = grip(view, 0);
      dragStart(handle);
      handle.dispatchEvent(new Event('dragend'));
      vi.runAllTimers();
      expect(view.dragging).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
