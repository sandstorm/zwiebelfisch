// @vitest-environment jsdom
// Tests for the markup extension's typing shortcuts (visual-editor.ts): Typst's markup typed into the text formats it.
import { describe, expect, it } from 'vitest';
import type { Node } from '@tiptap/pm/model';
import { serializeToTypst } from '../../../hosts/prosemirror-typst/prosemirror-typst';
import { createEditor, type } from '../../../testing/testing';

/** The document after typing `text` into an empty paragraph after "Text " (the cursor at its end). */
function typed(text: string): Node {
  const editor = createEditor('Text\n');
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  type(editor, ` ${text}`);
  return editor.state.doc;
}

/** The marks on the text `text` in `doc`. */
function marksOf(doc: Node, text: string): string[] {
  let marks: string[] | null = null;
  doc.descendants((node) => {
    if (marks === null && node.isText && node.text === text) marks = node.marks.map((m) => m.type.name);
  });
  if (marks === null) throw new Error(`no text node "${text}"`);
  return marks;
}

describe('typing markup in the Visual editor', () => {
  it('*foo* makes foo strong (bold)', () => {
    const doc = typed('*foo*');
    expect(marksOf(doc, 'foo')).toEqual(['bold']);
    expect(serializeToTypst(doc)).toBe('Text *foo*\n');
  });

  it('_foo_ makes foo emphasized (italic)', () => {
    const doc = typed('_foo_');
    expect(marksOf(doc, 'foo')).toEqual(['italic']);
    expect(serializeToTypst(doc)).toBe('Text _foo_\n');
  });

  it('`foo` makes foo inline code (raw)', () => {
    const doc = typed('`foo`');
    expect(marksOf(doc, 'foo')).toEqual(['code']);
    expect(serializeToTypst(doc)).toBe('Text `foo`\n');
  });

  it("Markdown's **foo** and __foo__ are not bold: they stay text, escaped", () => {
    for (const text of ['**foo**', '__foo__']) {
      const doc = typed(text);
      expect(doc.textContent).toBe(`Text ${text}`);
      expect(marksOf(doc, `Text ${text}`)).toEqual([]);
    }
  });

  it('a delimiter inside a word stays text (snake_case_name)', () => {
    const doc = typed('snake_case_name');
    expect(marksOf(doc, 'Text snake_case_name')).toEqual([]);
  });
});
