// @vitest-environment jsdom
import './jsdom-setup';
import type { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { TypstDocument } from '../../core/typst-document/typst-document';
import { VisualView } from './visual-view';

/** A Visual view over `text`, its toolbar, and its Tiptap editor (for typing). */
function setup(text: string) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const doc = new TypstDocument(text);
  const view = new VisualView(parent, doc);
  const toolbar = parent.querySelector<HTMLElement>('[role="toolbar"]')!;
  const button = (label: string) => {
    const found = toolbar.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    if (!found) throw new Error(`no button "${label}"`);
    return found;
  };
  const editor = (parent.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor;
  return { doc, view, button, editor, parent };
}

/** Types `text` character by character at the selection, as the browser would (input rules run). */
function type(editor: Editor, text: string): void {
  const { view } = editor;
  for (const char of text) {
    const { from, to } = view.state.selection;
    const insert = () => view.state.tr.insertText(char, from, to);
    const handled = view.someProp('handleTextInput', (f) => f(view, from, to, char, insert));
    if (!handled) view.dispatch(insert());
  }
}

describe('page breaks and horizontal rules', () => {
  it('"Insert page break" adds #pagebreak() after the paragraph', () => {
    const { doc, view, button, parent } = setup('Hello\n');
    view.reveal(5, 5);
    button('Insert page break').click();
    expect(doc.text).toBe('Hello\n\n#pagebreak()\n');
    expect(parent.querySelector('.typst-visual__page-break')?.textContent).toBe('Page break');
  });

  it('"Horizontal rule" adds #line(length: 100%)', () => {
    const { doc, view, button, parent } = setup('Hello\n');
    view.reveal(5, 5);
    button('Horizontal rule').click();
    expect(doc.text).toBe('Hello\n\n#line(length: 100%)\n');
    expect(parent.querySelector('.typst-visual__rule hr')).not.toBeNull();
  });

  it('"---" in an empty paragraph becomes a rule', () => {
    const { doc, view, editor } = setup('Hello\n');
    view.reveal(5, 5);
    editor.commands.splitBlock();
    type(editor, '---');
    expect(doc.text).toBe('Hello\n\n#line(length: 100%)\n\n\n');
    type(editor, 'Next');
    expect(doc.text).toBe('Hello\n\n#line(length: 100%)\n\nNext\n');
  });

  it('"---" inside text stays text (an em dash in Typst is written that way, so it is escaped)', () => {
    const { doc, view, editor } = setup('Hello\n');
    view.reveal(5, 5);
    type(editor, ' ---');
    expect(editor.state.doc.child(0).type.name).toBe('paragraph');
    expect(doc.text).toBe('Hello \\-\\--\n');
  });
});

describe('block quotes', () => {
  it('"Quote" wraps the paragraph in #quote(block: true)[..] and unwraps it again', () => {
    const { doc, view, button, parent } = setup('Hello\n');
    view.reveal(2, 2);
    button('Quote').click();
    expect(doc.text).toBe('#quote(block: true)[Hello]\n');
    expect(parent.querySelector('blockquote')?.textContent).toBe('Hello');
    expect(button('Quote').getAttribute('aria-pressed')).toBe('true');
    button('Quote').click();
    expect(doc.text).toBe('Hello\n');
  });

  it('"> " at the start of a paragraph starts a quote', () => {
    const { doc, view, editor } = setup('Hello\n');
    view.reveal(5, 5);
    editor.commands.splitBlock();
    type(editor, '> Wise words');
    expect(doc.text).toBe('Hello\n\n#quote(block: true)[Wise words]\n');
  });
});

describe('table header row', () => {
  it('"Header row" wraps the first row in table.header and back', () => {
    const source = 'Hi\n\n#table(columns: 2, [a], [b], [c], [d])\n';
    const { doc, view, button, parent } = setup(source);
    view.reveal(1, 1);
    expect(button('Header row').disabled).toBe(true);
    view.reveal(source.indexOf('c'), source.indexOf('c'));
    expect(button('Header row').getAttribute('aria-pressed')).toBe('false');
    button('Header row').click();
    expect(doc.text).toBe('Hi\n\n#table(\n  columns: 2,\n  table.header([a], [b]),\n  [c], [d],\n)\n');
    expect([...parent.querySelectorAll('th')].map((th) => th.textContent)).toEqual(['a', 'b']);
    expect(button('Header row').getAttribute('aria-pressed')).toBe('true');
    button('Header row').click();
    // the table has its projected shape again, so it prints its original source
    expect(doc.text).toBe(source);
  });
});

describe('task lists', () => {
  const PREAMBLE = '#import "@preview/cheq:0.4.0": checklist\n#show: checklist\n\n';

  it('"Task list" turns the paragraph into a task and adds cheq once', () => {
    const { doc, view, button, editor } = setup('= Todo\n\nBuy milk\n');
    view.reveal(16, 16);
    button('Task list').click();
    expect(doc.text).toBe(`${PREAMBLE}= Todo\n\n- [ ] Buy milk\n`);
    expect(button('Task list').getAttribute('aria-pressed')).toBe('true');
    editor.commands.splitListItem('taskItem');
    type(editor, 'Eggs');
    expect(doc.text).toBe(`${PREAMBLE}= Todo\n\n- [ ] Buy milk\n- [ ] Eggs\n`);
  });

  it('one undo removes the task list and the preamble it brought', () => {
    const { doc, view, button } = setup('Buy milk\n');
    view.reveal(1, 1);
    button('Task list').click();
    expect(doc.text).toBe(`${PREAMBLE}- [ ] Buy milk\n`);
    button('Undo').click();
    expect(doc.text).toBe('Buy milk\n');
  });

  it('"[ ] " at the start of a paragraph starts a task list', () => {
    const { doc, view, editor } = setup(`${PREAMBLE}Hello\n`);
    view.reveal(PREAMBLE.length + 5, PREAMBLE.length + 5);
    editor.commands.splitBlock();
    type(editor, '[x] Done');
    expect(doc.text).toBe(`${PREAMBLE}Hello\n\n- [x] Done\n`);
  });

  it('clicking a checkbox toggles [ ] and [x] in the source', () => {
    const source = `${PREAMBLE}- [ ] todo\n- [x] done\n`;
    const { doc, parent } = setup(source);
    const boxes = parent.querySelectorAll<HTMLInputElement>('ul[data-type="taskList"] input[type="checkbox"]');
    expect([...boxes].map((box) => box.checked)).toEqual([false, true]);
    boxes[0].checked = true;
    boxes[0].dispatchEvent(new Event('change', { bubbles: true }));
    expect(doc.text).toBe(`${PREAMBLE}- [x] todo\n- [x] done\n`);
    boxes[1].checked = false;
    boxes[1].dispatchEvent(new Event('change', { bubbles: true }));
    expect(doc.text).toBe(`${PREAMBLE}- [x] todo\n- [ ] done\n`);
  });

  it('a task list typed in the source does not add the preamble', () => {
    const { doc } = setup('Text\n');
    doc.setText('Text\n\n- [ ] a\n', 'source');
    expect(doc.text).toBe('Text\n\n- [ ] a\n');
  });
});

describe('heading numbers', () => {
  const numbers = (parent: HTMLElement) =>
    [...parent.querySelectorAll<HTMLElement>('[data-heading-number]')].map((h) => `${h.dataset.headingNumber} ${h.textContent}`);

  it('shows the numbers the set rule gives, beside the headings, following edits', () => {
    const { doc, parent } = setup('#set heading(numbering: "1.1")\n\n= A\n\n== B\n\n= C\n');
    expect(numbers(parent)).toEqual(['1 A', '1.1 B', '2 C']);
    expect(parent.querySelector('.typst-visual')!.classList.contains('typst-visual--numbered')).toBe(true);
    doc.setText('#set heading(numbering: "1.1")\n\n= A\n\n= New\n\n== B\n\n= C\n', 'source');
    expect(numbers(parent)).toEqual(['1 A', '2 New', '2.1 B', '3 C']);
  });

  it('"Numbered headings" adds and removes the set rule', () => {
    const { doc, button, parent } = setup('= A\n\n== B\n');
    expect(numbers(parent)).toEqual([]);
    expect(parent.querySelector('.typst-visual--numbered')).toBeNull();
    expect(button('Numbered headings').getAttribute('aria-pressed')).toBe('false');
    button('Numbered headings').click();
    expect(doc.text).toBe('#set heading(numbering: "1.")\n\n= A\n\n== B\n');
    expect(numbers(parent)).toEqual(['1. A', '1.1. B']);
    expect(button('Numbered headings').getAttribute('aria-pressed')).toBe('true');
    button('Numbered headings').click();
    expect(doc.text).toBe('= A\n\n== B\n');
  });
});
