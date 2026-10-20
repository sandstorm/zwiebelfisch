// @vitest-environment jsdom
// Tests for the lists' typing shortcuts (visual-editor.ts): `- ` bulleted, `+ ` (Typst) or `1. ` numbered.
import { describe, expect, it } from 'vitest';
import type { Node } from '@tiptap/pm/model';
import { serializeToTypst } from '../../../hosts/visual-editor/typst-conversion/typst-conversion';
import { createEditor, type } from '../../../testing/testing';

/** The document after typing `text` into a new paragraph after "Text". */
function typed(text: string): Node {
  const editor = createEditor('Text\n');
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  editor.commands.splitBlock();
  type(editor, text);
  return editor.state.doc;
}

describe('typing a list in the Visual editor', () => {
  it('"- " at a line start makes a bulleted list', () => {
    const doc = typed('- item');
    expect(doc.child(1).type.name).toBe('bulletList');
    expect(doc.child(1).textContent).toBe('item');
    expect(serializeToTypst(doc)).toBe('Text\n\n- item\n');
  });

  for (const marker of ['+', '1.']) {
    it(`"${marker} " at a line start makes a numbered list`, () => {
      const doc = typed(`${marker} item`);
      expect(doc.child(1).type.name).toBe('orderedList');
      expect(doc.child(1).textContent).toBe('item');
      expect(serializeToTypst(doc)).toBe('Text\n\n+ item\n');
    });
  }

  it('an item typed after a paragraph followed by others nests tightly: the split paragraph\'s blank line stays with it', () => {
    const editor = createEditor('Text\n\nMore\n');
    editor.commands.setTextSelection(editor.state.doc.firstChild!.nodeSize - 1);
    editor.commands.splitBlock();
    type(editor, '- one');
    editor.commands.splitListItem('listItem');
    type(editor, 'two');
    editor.commands.sinkListItem('listItem');
    expect(serializeToTypst(editor.state.doc)).toBe('Text\n\n- one\n  - two\n\nMore\n');
  });

  it('"* " stays text: in Typst * is strong, not a bullet', () => {
    const doc = typed('* item');
    expect(doc.child(1).type.name).toBe('paragraph');
    expect(doc.child(1).textContent).toBe('* item');
  });
});
