// @vitest-environment jsdom
// Tests for slash-commands.ts in a Visual editor with the built-in constructs (testing/): what `/` lists and what
// choosing runs.
import type { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { TypstDocument } from '../../core/typst-document/typst-document';
import { after, createVisualEditor, TestPrompts, type } from '../../testing/testing';
import { slashCommands } from './slash-commands';

function setup(text: string, cursorAfter: string, prompts = new TestPrompts()) {
  const parent = document.body.appendChild(document.createElement('div'));
  const doc = new TypstDocument(text);
  createVisualEditor(parent, doc, { contributions: [slashCommands()], prompts });
  const editor = (parent.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor;
  editor.commands.setTextSelection(after(editor.state.doc, cursorAfter));
  const list = parent.querySelector<HTMLElement>('[data-testid="typst-suggest"][data-trigger="/"]')!;
  const options = () => (list.hidden ? [] : [...list.querySelectorAll('[role="option"]')].map((o) => o.querySelector('.typst-visual__suggest-label')!.textContent));
  return { doc, editor, list, options, prompts };
}

function press(editor: Editor, key: string): void {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  editor.view.someProp('handleKeyDown', (f) => f(editor.view, event));
}

describe('slash commands', () => {
  it("list the Insert menu's entries, the list and alignment buttons, then the text styles", () => {
    const { editor, options, list } = setup('Some text\n', 'text');
    type(editor, ' /');
    expect(options()).toEqual([
      'Insert image',
      'Insert table',
      'Table of contents',
      'Code block',
      'Inline math',
      'Display math',
      'Quote',
      'Insert page break',
      'Horizontal rule',
      'Bulleted list',
      'Numbered list',
      'Task list',
      'Align left',
      'Center',
      'Align right',
      'Justify',
      'Heading 1',
      'Heading 2',
      'Heading 3',
    ]);
    expect(list.querySelector('.typst-visual__suggest-detail')?.textContent).toBe('Insert');
    expect(list.querySelector('.typst-visual__suggest-icon svg')).not.toBeNull();
  });

  it('find the lists by what people call them', () => {
    const { editor, options } = setup('Some text\n', 'text');
    type(editor, ' /123');
    expect(options()).toEqual(['Numbered list']);
    const second = setup('Some text\n', 'text');
    type(second.editor, ' /checklist');
    expect(second.options()).toEqual(['Task list']);
  });

  it('find math by what people call it', () => {
    for (const query of ['math', 'equation', 'formula']) {
      const { editor, options } = setup('Some text\n', 'text');
      type(editor, ` /${query}`);
      expect(options()).toEqual(['Inline math', 'Display math']);
    }
  });

  it('are found by label and keywords', () => {
    const { editor, options } = setup('Some text\n', 'text');
    type(editor, ' /table');
    expect(options()).toEqual(['Table of contents', 'Insert table']);
    type(editor, ' /spreadsheet');
    expect(options()).toEqual(['Insert table']);
    type(editor, ' /h2');
    expect(options()).toEqual(['Heading 2']);
  });

  it('choosing one removes the /query and runs it', () => {
    const { doc, editor } = setup('Some text\n', 'text');
    type(editor, ' /spreadsheet');
    press(editor, 'Enter');
    expect(doc.text).not.toContain('/spreadsheet');
    expect(doc.text).toContain('#table(');
  });

  it('applies a text style to the block', () => {
    const { doc, editor } = setup('Intro\n\nText\n', 'Text');
    type(editor, ' /h2');
    press(editor, 'Enter');
    expect(editor.isActive('heading', { level: 2 })).toBe(true);
    expect(doc.text).not.toContain('/h2');
  });

  it('runs an entry that asks first (Insert image) as its button does', async () => {
    const { doc, editor, prompts } = setup('Some text\n', 'text');
    type(editor, ' /image');
    press(editor, 'Enter');
    expect(doc.text).not.toContain('/image');
    await new Promise((resolve) => setTimeout(resolve));
    expect(prompts.asked[0].options).toMatchObject({ title: 'Insert image' });
  });

  it('offer nothing in code', () => {
    const { editor, list } = setup('```\ncode\n```\n\nx `a b` y\n', 'code');
    type(editor, ' /');
    expect(list.hidden).toBe(true);
    editor.commands.setTextSelection(after(editor.state.doc, 'a '));
    type(editor, '/');
    expect(list.hidden).toBe(true);
  });

  it('need a line start or a space before the /', () => {
    const { editor, list } = setup('and\n', 'and');
    type(editor, '/');
    expect(list.hidden).toBe(true);
  });
});

describe('the hint "Type / for commands"', () => {
  /** A focused Visual editor of `text` with the cursor after `cursorAfter`, and the paragraphs showing the hint. */
  function focused(text: string, cursorAfter: string) {
    const view = setup(text, cursorAfter);
    view.editor.view.dom.focus();
    const hints = () => [...view.editor.view.dom.querySelectorAll<HTMLElement>('.typst-slash-commands__hint')];
    return { ...view, hints };
  }

  it('shows in the empty paragraph holding the cursor only, never in the document', () => {
    const { doc, editor, hints } = focused('First\n\nSecond\n', 'First');
    editor.commands.splitBlock();
    editor.commands.splitBlock();
    expect(hints()).toHaveLength(1);
    expect(hints()[0].tagName).toBe('P');
    expect(hints()[0].dataset.hint).toBe('Type / for commands');
    expect(hints()[0].contains(editor.view.domAtPos(editor.state.selection.from).node)).toBe(true);
    expect(doc.text).not.toContain('Type /');
  });

  it('goes when something is typed, the cursor leaves the line or the editor loses focus', () => {
    const { editor, hints } = focused('First\n', 'First');
    editor.commands.splitBlock();
    expect(hints()).toHaveLength(1);
    type(editor, 'a');
    expect(hints()).toHaveLength(0);
    editor.commands.deleteRange({ from: editor.state.selection.from - 1, to: editor.state.selection.from });
    expect(hints()).toHaveLength(1);
    editor.commands.setTextSelection(after(editor.state.doc, 'First'));
    expect(hints()).toHaveLength(0);
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    expect(hints()).toHaveLength(1);
    editor.view.dom.blur();
    expect(hints()).toHaveLength(0);
  });

  it('shows in an empty list item', () => {
    const { editor, hints } = focused('- item\n', 'item');
    editor.commands.splitListItem('listItem');
    expect(editor.state.selection.$from.node(-1).type.name).toBe('listItem');
    expect(hints()).toHaveLength(1);
  });

  it('does not show in an empty heading, code block or table cell', () => {
    const { editor, hints } = focused('= Title\n\n```\ncode\n```\n\n#table(columns: 2, [a], [b])\n', 'Title');
    for (const text of ['Title', 'code', 'a']) {
      const end = after(editor.state.doc, text);
      editor.chain().setTextSelection({ from: end - text.length, to: end }).deleteSelection().run();
      expect(editor.state.selection.$from.parent.content.size).toBe(0);
      expect(hints()).toHaveLength(0);
    }
  });
});
