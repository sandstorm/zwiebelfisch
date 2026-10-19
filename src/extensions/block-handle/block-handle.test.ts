// @vitest-environment jsdom
// Tests for block-handle.ts, in a Visual editor with the built-ins: paragraphs, raw boxes, list items at any depth, a table.
import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TypstDocument } from '../../core/typst-document/typst-document';
import { blockHandle, createVisualEditor, dragStart, drop } from '../../testing/testing';

function setup(text: string) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const doc = new TypstDocument(text);
  createVisualEditor(parent, doc);
  const tiptap = (parent.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor;
  const { view } = tiptap;
  /** Where each node named `name` starts, in document order. */
  const starts = (name: string) => {
    const found: number[] = [];
    view.state.doc.descendants((node, pos) => void (node.type.name === name && found.push(pos)));
    return found;
  };
  /** The block whose handle is dragged (an item: the slice is open into its list). */
  const dragged = () => {
    const slice = view.dragging?.slice;
    let content = slice?.content;
    for (let depth = 0; content && depth < slice!.openStart; depth++) content = content.firstChild?.content;
    return content?.firstChild ?? null;
  };
  return { doc, tiptap, view, parent, starts, dragged };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('the block handle', () => {
  it('shows beside the block at the pointer\'s height, the first one above all blocks', () => {
    const { view } = setup('Hello\n\n#let a = 1\n\nWorld\n');
    const box = view.state.doc.child(0).nodeSize;
    const handle = blockHandle(view, box);
    expect(handle.hidden).toBe(false);
    expect(handle.draggable).toBe(true);
    dragStart(handle);
    expect(view.dragging?.slice.content.firstChild?.type.name).toBe('rawBlock');
    expect(view.state.selection instanceof NodeSelection && view.state.selection.from).toBe(box);
    dragStart(blockHandle(view, -5));
    expect(view.dragging?.slice.content.firstChild?.textContent).toBe('Hello');
  });

  it('hides when the pointer leaves the text, on a key press and after an edit; never shows read-only', () => {
    const { view, tiptap, parent } = setup('Hello\n\nWorld\n');
    const handle = blockHandle(view, 0);
    view.dom.dispatchEvent(new MouseEvent('mouseleave', { relatedTarget: handle }));
    expect(handle.hidden).toBe(false);
    view.dom.dispatchEvent(new MouseEvent('mouseleave', { relatedTarget: parent }));
    expect(handle.hidden).toBe(true);
    blockHandle(view, 0);
    view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(handle.hidden).toBe(true);
    blockHandle(view, 0);
    tiptap.commands.insertContentAt(1, 'Oh ');
    expect(handle.hidden).toBe(true);
    tiptap.setEditable(false);
    expect(blockHandle(view, 0).hidden).toBe(true);
  });

  it('dragged elsewhere, moves its block there, the Typst verbatim, in one undo step', () => {
    const text = 'A *bold*   start.\n\n#set text(size: 12pt)\n\nEnd\n';
    const { doc, tiptap, view } = setup(text);
    dragStart(blockHandle(view, 0));
    expect(view.dragging?.move).toBe(true);
    drop(view, view.dom, view.state.doc.content.size);
    expect(doc.text).toBe('#set text(size: 12pt)\n\nEnd\n\nA *bold*   start.\n');
    tiptap.commands.undo();
    expect(doc.text).toBe(text);
  });

  it('moves a raw box by its handle', () => {
    const { doc, view } = setup('#set text(size: 12pt)\n\nHello\n\nWorld\n');
    dragStart(blockHandle(view, 0));
    drop(view, view.dom.querySelectorAll('p')[1], view.state.doc.content.size);
    expect(doc.text).toBe('Hello\n\nWorld\n\n#set text(size: 12pt)\n');
  });

  it('dropped on a raw box\'s code, a block lands beside the box, not in its code', () => {
    const { doc, view } = setup('#let a = 1\n\n#let b = 2\n\nHello\n');
    dragStart(blockHandle(view, view.state.doc.content.size - 7));
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
    blockHandle(view, second).click();
    const { selection } = view.state;
    expect(selection instanceof NodeSelection && selection.from).toBe(second);
  });

  it('a drag that ends without a drop in the editor moves nothing', () => {
    vi.useFakeTimers();
    try {
      const { view } = setup('Hello\n\nWorld\n');
      const handle = blockHandle(view, 0);
      dragStart(handle);
      handle.dispatchEvent(new Event('dragend'));
      vi.runAllTimers();
      expect(view.dragging).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('block handles on lists', () => {
  it('an item has its own handle at any depth, found by its first line; a table one for all in it', () => {
    const { view, starts, dragged } = setup('= Title\n\n- one\n  - nested\n- two\n\n#table(columns: 2, [a], [b])\n');
    dragStart(blockHandle(view, 0));
    expect(dragged()?.type.name).toBe('heading');
    const [first, nested] = starts('listItem');
    dragStart(blockHandle(view, first));
    expect(dragged()?.textContent).toBe('onenested');
    dragStart(blockHandle(view, nested));
    expect(dragged()?.textContent).toBe('nested');
    dragStart(blockHandle(view, starts('tableCell')[1]));
    expect(dragged()?.type.name).toBe('table');
  });

  it('dragged within its list, an item moves there, its Typst verbatim', () => {
    const { doc, view, starts } = setup('- one\n- two\n- three\n');
    const [first, , third] = starts('listItem');
    dragStart(blockHandle(view, first));
    drop(view, view.dom, third);
    expect(doc.text).toBe('- two\n- one\n- three\n');
  });
});
