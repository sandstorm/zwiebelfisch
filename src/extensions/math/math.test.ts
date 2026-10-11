// @vitest-environment jsdom
// Tests for the math extension (math.ts) in a Visual editor with the built-ins (testing/): typing math, the Insert
// menu's entries.
import { EditorView } from '@codemirror/view';
import type { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { TypstDocument } from '../../core/typst-document/typst-document';
import { after, createVisualEditor, find, type } from '../../testing/testing';

/** A Visual editor of `text`, the cursor after `cursorAfter` (default: at the end of the first block). */
function setup(text: string, cursorAfter?: string) {
  const parent = document.body.appendChild(document.createElement('div'));
  const doc = new TypstDocument(text);
  createVisualEditor(parent, doc);
  const editor = (parent.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor;
  editor.commands.setTextSelection(cursorAfter === undefined ? editor.state.doc.firstChild!.nodeSize - 1 : after(editor.state.doc, cursorAfter));
  const insert = (label: string) => {
    const button = parent.querySelector<HTMLButtonElement>(`button[aria-label="${label}"], [role="menuitem"][aria-label="${label}"]`);
    if (!button) throw new Error(`no ${label}`);
    button.click();
  };
  return { doc, editor, parent, insert };
}

/** The focused code editor's text and cursor, as `before|after`. */
function focusedCode(parent: HTMLElement): string {
  const content = parent.querySelector<HTMLElement>('.cm-content:focus, .cm-focused .cm-content');
  if (!content) throw new Error('no code has focus');
  const { state } = EditorView.findFromDOM(content)!;
  const code = state.doc.toString();
  return `${code.slice(0, state.selection.main.head)}|${code.slice(state.selection.main.head)}`;
}

describe('typing math', () => {
  it('$a^1$ becomes an inline raw box with the math as its source', () => {
    const { doc, editor } = setup('With\n');
    type(editor, ' $a^1$ more');
    expect(find(editor.state.doc, 'rawInline').node.attrs.src).toBe('$a^1$');
    expect(doc.text).toBe('With $a^1$ more\n');
  });

  it('Backspace right after gives the typed text back', () => {
    const { doc, editor } = setup('With\n');
    type(editor, ' $x$');
    editor.commands.undoInputRule();
    expect(doc.text).toBe('With \\$x\\$\n');
  });

  it('a $ after a backslash stays text', () => {
    const { doc, editor } = setup('Price\n');
    type(editor, ' \\$a^1\\$');
    expect(() => find(editor.state.doc, 'rawInline')).toThrow();
    expect(editor.state.doc.textContent).toBe('Price \\$a^1\\$');
    expect(doc.text).not.toContain(' $a');
  });

  it('a space inside one dollar only stays text ($5 and $10)', () => {
    const { editor } = setup('Costs\n');
    type(editor, ' $5 and $10');
    expect(() => find(editor.state.doc, 'rawInline')).toThrow();
    expect(editor.state.doc.textContent).toBe('Costs $5 and $10');
  });

  it('an escaped \\$ of the source is not an opening dollar', () => {
    const { editor } = setup('Costs \\$5\n');
    type(editor, ' x$');
    expect(() => find(editor.state.doc, 'rawInline')).toThrow();
  });

  it('$ x $ alone in a paragraph becomes a block raw box (display math), the cursor in the paragraph after', () => {
    const { doc, editor } = setup('Intro\n\nOutro\n', 'Intro');
    editor.commands.splitBlock();
    type(editor, '$ x^2 $');
    expect(find(editor.state.doc, 'rawBlock').node.attrs.src).toBe('$ x^2 $');
    expect(doc.text).toBe('Intro\n\n$ x^2 $\n\nOutro\n');
    expect(editor.state.selection.$from.parent.textContent).toBe('Outro');
  });

  it('$ x $ after text in a paragraph stays inline', () => {
    const { doc, editor } = setup('So\n');
    type(editor, ' $ x $');
    expect(find(editor.state.doc, 'rawInline').node.attrs.src).toBe('$ x $');
    expect(doc.text).toBe('So $ x $\n');
  });

  it('display math in the last paragraph gets a paragraph after it to go on typing', () => {
    const { doc, editor } = setup('Intro\n\nx\n');
    editor.commands.setTextSelection(after(editor.state.doc, 'x'));
    editor.commands.deleteRange({ from: editor.state.selection.from - 1, to: editor.state.selection.from });
    type(editor, '$ y $');
    type(editor, 'Then');
    expect(doc.text).toBe('Intro\n\n$ y $\n\nThen\n');
  });

  it('not in inline code', () => {
    const { doc, editor } = setup('See `x`\n', 'x');
    type(editor, ' $a$');
    expect(doc.text).toBe('See `x $a$`\n');
  });
});

describe('Insert → math', () => {
  it('"Inline math" inserts $$ at the cursor and edits its code between the dollars', () => {
    const { doc, parent, insert } = setup('With\n');
    insert('Inline math');
    expect(doc.text).toBe('With$$\n');
    expect(focusedCode(parent)).toBe('$|$');
  });

  it('"Display math" inserts a block $  $ after the paragraph and edits its code inside', () => {
    const { doc, parent, insert } = setup('Intro\n');
    insert('Display math');
    expect(doc.text).toBe('Intro\n\n$  $\n');
    expect(focusedCode(parent)).toBe('$ | $');
  });
});
