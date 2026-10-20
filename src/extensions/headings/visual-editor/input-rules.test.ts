// @vitest-environment jsdom
// Tests for the heading's typing shortcuts (visual-editor.ts): `= ` (Typst) or `# ` (Markdown) at a line start.
import { describe, expect, it } from 'vitest';
import type { Node } from '@tiptap/pm/model';
import { serializeToTypst } from '../../../hosts/visual-editor/visual-editor';
import { createEditor, type } from '../../../testing/testing';

/** The document after typing `text` into a new paragraph after "Text". */
function typed(text: string): Node {
  const editor = createEditor('Text\n');
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  editor.commands.splitBlock();
  type(editor, text);
  return editor.state.doc;
}

describe('typing a heading in the Visual editor', () => {
  for (const [marker, level] of [['=', 1], ['==', 2], ['===', 3], ['#', 1], ['##', 2], ['###', 3]] as const) {
    it(`"${marker} " at a line start makes a heading of level ${level}`, () => {
      const doc = typed(`${marker} Title`);
      const heading = doc.child(1);
      expect(heading.type.name).toBe('heading');
      expect(heading.attrs.level).toBe(level);
      expect(heading.textContent).toBe('Title');
      expect(serializeToTypst(doc)).toBe(`Text\n\n${'='.repeat(level)} Title\n`);
    });
  }

  it('"= " inside a line stays text', () => {
    const doc = typed('a = b');
    expect(doc.child(1).type.name).toBe('paragraph');
    expect(doc.child(1).textContent).toBe('a = b');
  });
});
