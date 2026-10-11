// @vitest-environment jsdom
// Tests for the completion lists (suggestions.ts, suggest-widget.ts) through the Visual view, with providers defined here.
import type { Editor } from '@tiptap/core';
import { describe, expect, it, vi } from 'vitest';
import { TypstDocument } from '../../../core/typst-document/typst-document';
import { VisualView, VisualViewHost, type CompletionContext, type CompletionItem, type CompletionTrigger, type ToolbarAction } from '../visual-view';
import { filterCompletionItems } from './suggestions';

// jsdom lacks layout; ProseMirror only needs these to exist.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

/** An item that records being chosen (with the range it replaces) and inserts its label in capitals there. */
function item(label: string, extra: Partial<CompletionItem> = {}): CompletionItem {
  return {
    label,
    command: vi.fn(({ editor, range }) => editor.chain().insertContentAt(range, label.toUpperCase()).run()),
    ...extra,
  };
}

const ITEMS = [item('apple', { detail: 'Fruit', keywords: ['pome'] }), item('banana'), item('cherry', { commitCharacters: ['.'] })];

const INSERT_RULE: ToolbarAction = { label: 'Rule', icon: '<svg></svg>', run: (c) => c };

function setup(text = 'Text\n', items: readonly CompletionItem[] = ITEMS, trigger: CompletionTrigger = { char: '/' }) {
  const asked: CompletionContext[] = [];
  const parent = document.body.appendChild(document.createElement('div'));
  const doc = new TypstDocument(text);
  new VisualView(
    parent,
    doc,
    VisualViewHost.from([
      {
        id: 'test',
        activate: ({ visualView, subscriptions }) =>
          subscriptions.push(
            visualView.registerToolbarItem({ group: 'insert', action: INSERT_RULE }),
            visualView.registerCompletionItemProvider(
              {
                provideCompletionItems: (context) => {
                  asked.push(context);
                  return items;
                },
              },
              trigger,
            ),
          ),
      },
    ]),
  );
  const editor = (parent.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor;
  const list = parent.querySelector<HTMLElement>('[data-testid="typst-suggest"]')!;
  const options = () => [...list.querySelectorAll('[role="option"]')].map((o) => o.querySelector('.typst-visual__suggest-label')!.textContent);
  const chosen = () => list.querySelector('[aria-selected="true"] .typst-visual__suggest-label')?.textContent;
  editor.commands.setTextSelection(editor.state.doc.content.size - 1); // the end of the text
  return { doc, editor, list, options, chosen, asked };
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

function press(editor: Editor, key: string): boolean {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  return editor.view.someProp('handleKeyDown', (f) => f(editor.view, event)) ?? false;
}

describe('completion lists', () => {
  it('open after the trigger at a line start or after a space, not within a word', () => {
    const { editor, list, options } = setup('\n');
    type(editor, '/');
    expect(list.hidden).toBe(false);
    expect(options()).toEqual(['apple', 'banana', 'cherry']);
    type(editor, 'x and/');
    expect(list.hidden).toBe(true);
    type(editor, ' /');
    expect(list.hidden).toBe(false);
  });

  it('take further prefixes where the trigger says so', () => {
    const { editor, list } = setup('\n', ITEMS, { char: '@', allowedPrefixes: [' ', '('] });
    type(editor, 'see (@');
    expect(list.hidden).toBe(false);
    expect(list.dataset.trigger).toBe('@');
  });

  it('filter by the query, and stay closed while nothing matches', () => {
    const { editor, list, options } = setup();
    type(editor, ' /an');
    expect(options()).toEqual(['banana']);
    type(editor, 'x');
    expect(list.hidden).toBe(true);
    press(editor, 'Enter'); // not the list's: splits the paragraph
    expect(editor.state.doc.childCount).toBe(2);
  });

  it('ask the provider with the query, the editor and what the toolbar offers', () => {
    const { editor, asked } = setup();
    type(editor, ' /ch');
    const context = asked.at(-1)!;
    expect(context.query).toBe('ch');
    expect(context.editor).toBe(editor);
    expect(context.toolbarActions('insert')).toEqual([INSERT_RULE]);
    expect(context.textStyles()).toEqual([]);
  });

  it('arrow keys choose (wrapping around), Enter replaces the trigger and query with the chosen item', () => {
    const { doc, editor, list, chosen } = setup();
    type(editor, ' /');
    expect(chosen()).toBe('apple');
    press(editor, 'ArrowUp');
    expect(chosen()).toBe('cherry');
    press(editor, 'ArrowDown');
    press(editor, 'ArrowDown');
    expect(chosen()).toBe('banana');
    expect(press(editor, 'Enter')).toBe(true);
    expect(ITEMS[1].command).toHaveBeenCalledWith({ editor, range: { from: 6, to: 7 } });
    expect(doc.text).toBe('Text BANANA\n');
    expect(list.hidden).toBe(true);
  });

  it('Tab chooses, too', () => {
    const { doc, editor } = setup();
    type(editor, ' /ap');
    expect(press(editor, 'Tab')).toBe(true);
    expect(doc.text).toBe('Text APPLE\n');
  });

  it('Escape closes the list and keeps the text; it stays closed until another trigger is typed', () => {
    const { doc, editor, list } = setup();
    type(editor, ' /b');
    expect(press(editor, 'Escape')).toBe(true);
    expect(list.hidden).toBe(true);
    type(editor, 'a');
    expect(list.hidden).toBe(true);
    type(editor, ' /');
    expect(list.hidden).toBe(false);
    expect(doc.text).toBe('Text /ba /\n');
  });

  it('the pointer chooses, a click accepts', () => {
    const { doc, editor, list, chosen } = setup();
    type(editor, ' /');
    const option = list.querySelectorAll<HTMLElement>('[role="option"]')[2];
    option.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    expect(chosen()).toBe('cherry');
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    option.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true); // the editor keeps its selection
    expect(doc.text).toBe('Text CHERRY\n');
  });

  it("a chosen item's commit character accepts it and is typed after it", () => {
    const { doc, editor } = setup();
    type(editor, ' /cherry.');
    expect(doc.text).toBe('Text CHERRY.\n');
    type(editor, ' /banana.'); // banana has no commit characters
    expect(doc.text).toBe('Text CHERRY. /banana.\n');
  });

  it('is a listbox whose chosen option the editor names (aria-activedescendant) while it shows', () => {
    const { editor, list } = setup();
    const input = editor.view.dom;
    type(editor, ' /');
    expect(list.getAttribute('role')).toBe('listbox');
    expect(input.getAttribute('aria-controls')).toBe(list.id);
    const first = list.querySelector('[role="option"]')!;
    expect(input.getAttribute('aria-activedescendant')).toBe(first.id);
    expect(first.getAttribute('aria-selected')).toBe('true');
    expect(list.querySelector('.typst-visual__suggest-detail')?.textContent).toBe('Fruit');
    press(editor, 'ArrowDown');
    expect(input.getAttribute('aria-activedescendant')).toBe(list.querySelectorAll('[role="option"]')[1].id);
    press(editor, 'Escape');
    expect(input.hasAttribute('aria-activedescendant')).toBe(false);
  });
});

describe('filterCompletionItems', () => {
  const labels = (query: string) => filterCompletionItems([item('Intro', { keywords: ['Introduction'] }), item('tab:timings'), item('fig:compile-times'), item('int'), item('results')], query).map((i) => i.label);

  it('keeps every item for an empty query, in order', () => {
    expect(labels('')).toEqual(['Intro', 'tab:timings', 'fig:compile-times', 'int', 'results']);
  });

  it('puts an equal label first, then labels starting with the query, then containing it, then keywords; ignores case', () => {
    expect(labels('int')).toEqual(['int', 'Intro']);
    expect(labels('ti')).toEqual(['tab:timings', 'fig:compile-times', 'Intro']);
    expect(labels('RES')).toEqual(['results']);
    expect(labels('zzz')).toEqual([]);
  });
});
