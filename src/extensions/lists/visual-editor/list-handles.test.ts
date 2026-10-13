// @vitest-environment jsdom
// Tests for the Visual editor's block handle (hosts/visual-editor/block-handle.ts) on lists and the other built-in blocks:
// every list item has one, at any depth; what is in a table moves with the table.
import type { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { TypstDocument } from '../../../core/typst-document/typst-document';
import { blockHandle, createVisualEditor, dragStart, drop } from '../../../testing/testing';

function setup(text: string) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const doc = new TypstDocument(text);
  createVisualEditor(parent, doc);
  const { view } = (parent.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor;
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
  return { doc, view, starts, dragged };
}

afterEach(() => {
  document.body.replaceChildren();
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
