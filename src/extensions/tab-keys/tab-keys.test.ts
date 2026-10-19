// @vitest-environment jsdom
// Tests for tab-keys.ts, in a Visual editor with the other built-ins (as in the widget).
import { EditorView as CodeView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { SourceRange, TypstDocument } from '../../core/typst-document/typst-document';
import { createVisualEditor } from '../../testing/testing';

/** Presses `name` (with Shift: `shift`) in `target`; returns whether something consumed it (the browser does nothing then). */
const press = (target: HTMLElement, name: string, shift = false) => !target.dispatchEvent(new KeyboardEvent('keydown', { key: name, shiftKey: shift, bubbles: true, cancelable: true }));

function setup(text: string) {
  const parent = document.body.appendChild(document.createElement('div'));
  const doc = new TypstDocument(text);
  const view = createVisualEditor(parent, doc);
  const editable = parent.querySelector<HTMLElement>('[contenteditable]')!;
  return { doc, view, editable };
}

describe('tabKeys', () => {
  it('consumes Tab and Shift+Tab where no construct takes them, changing nothing', () => {
    const source = 'Title\n\nSome text.\n';
    const { doc, view, editable } = setup(source);
    view.reveal(SourceRange.of({ from: source.indexOf('text'), to: source.indexOf('text') }));
    expect(press(editable, 'Tab')).toBe(true);
    expect(press(editable, 'Tab', true)).toBe(true);
    expect(doc.text).toBe(source);
    expect(view.selection().from).toBe(source.indexOf('text'));
  });

  it('lets the Tab or Shift+Tab right after Escape through to the browser, once', () => {
    const { editable } = setup('Text\n');
    press(editable, 'Escape');
    expect(press(editable, 'Tab')).toBe(false);
    expect(press(editable, 'Tab')).toBe(true);
    press(editable, 'Escape');
    press(editable, 'Shift');
    expect(press(editable, 'Tab', true)).toBe(false);
  });

  it('consumes Tab again once another key came after Escape', () => {
    const { editable } = setup('Text\n');
    press(editable, 'Escape');
    press(editable, 'ArrowLeft');
    expect(press(editable, 'Tab')).toBe(true);
  });

  it("Tab and Shift+Tab indent and outdent a code block's line by two spaces", () => {
    const source = '```py\nx = 1\n```\n';
    const { doc, view, editable } = setup(source);
    view.reveal(SourceRange.of({ from: source.indexOf('x'), to: source.indexOf('x') }));
    press(editable, 'Tab');
    expect(doc.text).toBe('```py\n  x = 1\n```\n');
    press(editable, 'Tab', true);
    expect(doc.text).toBe(source);
  });

  it("Tab and Shift+Tab indent and outdent every selected line of a code block, also in a list item; Escape, then Tab goes to the browser", () => {
    const source = '- item\n\n  ```py\n  if a:\n  x = 1\n  y = 2\n  ```\n';
    const { doc, view, editable } = setup(source);
    view.reveal(SourceRange.of({ from: source.indexOf('f a'), to: source.indexOf('= 1') }));
    expect(press(editable, 'Tab')).toBe(true);
    expect(doc.text).toBe('- item\n\n  ```py\n    if a:\n    x = 1\n  y = 2\n  ```\n');
    expect(press(editable, 'Tab', true)).toBe(true);
    expect(press(editable, 'Tab', true)).toBe(true);
    expect(doc.text).toBe(source);
    press(editable, 'Escape');
    expect(press(editable, 'Tab')).toBe(false);
    expect(doc.text).toBe(source);
    // the browser moves on from right after the editor, not to what is focusable inside it
    const stop = document.activeElement!;
    expect(stop.previousElementSibling).toBe(editable);
    editable.focus();
    expect(stop.isConnected).toBe(false);
  });

  it('lets the Tab after an Escape in a raw box through to the browser too', () => {
    const source = '#set text(size: 12pt)\n\nText\n';
    const { doc, editable } = setup(source);
    const box = CodeView.findFromDOM(editable.querySelector<HTMLElement>('.zwf-visual__raw-block .cm-content')!)!;
    press(box.contentDOM, 'Escape');
    expect(press(box.contentDOM, 'Tab')).toBe(false);
    expect(doc.text).toBe(source);
  });
});
