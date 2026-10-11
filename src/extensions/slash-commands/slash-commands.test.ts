// @vitest-environment jsdom
// Tests for slash-commands.ts in a Visual view with the built-in constructs (testing/): what `/` lists and what
// choosing runs.
import type { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { TypstDocument } from '../../core/typst-document/typst-document';
import { after, createVisualView, TestPrompts } from '../../testing/testing';
import { slashCommands } from './slash-commands';

function setup(text: string, cursorAfter: string, prompts = new TestPrompts()) {
  const parent = document.body.appendChild(document.createElement('div'));
  const doc = new TypstDocument(text);
  createVisualView(parent, doc, { contributions: [slashCommands()], prompts });
  const editor = (parent.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor;
  editor.commands.setTextSelection(after(editor.state.doc, cursorAfter));
  const list = parent.querySelector<HTMLElement>('[data-testid="typst-suggest"][data-trigger="/"]')!;
  const options = () => (list.hidden ? [] : [...list.querySelectorAll('[role="option"]')].map((o) => o.querySelector('.typst-visual__suggest-label')!.textContent));
  return { doc, editor, list, options, prompts };
}

/** Types `text` at the selection as the browser would (text input handlers run). */
function type(editor: Editor, text: string): void {
  const { view } = editor;
  for (const char of text) {
    const { from, to } = view.state.selection;
    const insert = () => view.state.tr.insertText(char, from, to);
    if (!view.someProp('handleTextInput', (f) => f(view, from, to, char, insert))) view.dispatch(insert());
  }
}

function press(editor: Editor, key: string): void {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  editor.view.someProp('handleKeyDown', (f) => f(editor.view, event));
}

describe('slash commands', () => {
  it("list the Insert menu's entries, then the text styles", () => {
    const { editor, options, list } = setup('Some text\n', 'text');
    type(editor, ' /');
    expect(options()).toEqual([
      'Insert image',
      'Insert table',
      'Table of contents',
      'Code block',
      'Quote',
      'Insert page break',
      'Horizontal rule',
      'Heading 1',
      'Heading 2',
      'Heading 3',
    ]);
    expect(list.querySelector('.typst-visual__suggest-detail')?.textContent).toBe('Insert');
    expect(list.querySelector('.typst-visual__suggest-icon svg')).not.toBeNull();
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
