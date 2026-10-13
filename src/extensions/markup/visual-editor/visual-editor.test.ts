// @vitest-environment jsdom
// Tests for the markup extension's Visual-editor keymap (with the other built-ins, as in the widget).
import { describe, expect, it } from 'vitest';
import { SourceRange, TypstDocument } from '../../../core/typst-document/typst-document';
import { createVisualEditor } from '../../../testing/testing';

// with Shift, browsers report the upper-case key; ProseMirror matches it by key code
function press(target: HTMLElement, key: string, shiftKey = false) {
  const mac = /Mac/.test(navigator.platform);
  const event = new KeyboardEvent('keydown', { key, keyCode: key.toUpperCase().charCodeAt(0), shiftKey, metaKey: mac, ctrlKey: !mac, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

describe('markup in a Visual editor', () => {
  it('handles Mod-b, Mod-i, Mod-u and Mod-Shift-s itself instead of letting the browser act; Mod-Shift-h is not its own', () => {
    const parent = document.body.appendChild(document.createElement('div'));
    createVisualEditor(parent, new TypstDocument('Hello\n'));
    const editable = parent.querySelector<HTMLElement>('[contenteditable]')!;
    editable.focus();
    expect(press(editable, 'b').defaultPrevented).toBe(true);
    expect(press(editable, 'i').defaultPrevented).toBe(true);
    expect(press(editable, 'u').defaultPrevented).toBe(true);
    expect(press(editable, 'S', true).defaultPrevented).toBe(true);
    expect(press(editable, 'H', true).defaultPrevented).toBe(false);
  });

  it('leaves inline code, code blocks and raw boxes out of spell checking', () => {
    const parent = document.body.appendChild(document.createElement('div'));
    createVisualEditor(parent, new TypstDocument('Some `kode` and $x$\n\n```js\nlet wrod\n```\n'));
    expect(parent.querySelector('.zwf-markup__code-inline')?.getAttribute('spellcheck')).toBe('false');
    expect(parent.querySelector('.zwf-markup__code-block')?.getAttribute('spellcheck')).toBe('false');
    expect(parent.querySelector('.zwf-visual__raw-inline .cm-content')?.getAttribute('spellcheck')).toBe('false');
  });

  it('Mod-u underlines the selection', () => {
    const parent = document.body.appendChild(document.createElement('div'));
    const doc = new TypstDocument('Hello world\n');
    const view = createVisualEditor(parent, doc);
    view.reveal(SourceRange.of({ from: 6, to: 11 }));
    press(parent.querySelector<HTMLElement>('[contenteditable]')!, 'u');
    expect(doc.text).toBe('Hello #underline[world]\n');
  });

  it("Tab and Shift+Tab indent and outdent a code block's line by two spaces", () => {
    const parent = document.body.appendChild(document.createElement('div'));
    const source = '```py\nx = 1\n```\n';
    const doc = new TypstDocument(source);
    const view = createVisualEditor(parent, doc);
    view.reveal(SourceRange.of({ from: source.indexOf('x'), to: source.indexOf('x') }));
    const editable = parent.querySelector<HTMLElement>('[contenteditable]')!;
    const tab = (shiftKey: boolean) => editable.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true }));
    tab(false);
    expect(doc.text).toBe('```py\n  x = 1\n```\n');
    tab(true);
    expect(doc.text).toBe(source);
  });

  it("Tab and Shift+Tab indent and outdent every selected line of a code block, also in a list item; Escape, then Tab goes to the browser", () => {
    const parent = document.body.appendChild(document.createElement('div'));
    const source = '- item\n\n  ```py\n  if a:\n  x = 1\n  y = 2\n  ```\n';
    const doc = new TypstDocument(source);
    const view = createVisualEditor(parent, doc);
    view.reveal(SourceRange.of({ from: source.indexOf('f a'), to: source.indexOf('= 1') }));
    const editable = parent.querySelector<HTMLElement>('[contenteditable]')!;
    const press = (key: string, shiftKey = false) => !editable.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }));
    expect(press('Tab')).toBe(true);
    expect(doc.text).toBe('- item\n\n  ```py\n    if a:\n    x = 1\n  y = 2\n  ```\n');
    expect(press('Tab', true)).toBe(true);
    expect(press('Tab', true)).toBe(true);
    expect(doc.text).toBe(source);
    press('Escape');
    expect(press('Tab')).toBe(false);
    expect(doc.text).toBe(source);
    // the browser moves on from right after the editor, not to what is focusable inside it
    const stop = document.activeElement!;
    expect(stop.previousElementSibling).toBe(editable);
    editable.focus();
    expect(stop.isConnected).toBe(false);
  });

  it('Mod-Shift-s strikes the selection through', () => {
    const parent = document.body.appendChild(document.createElement('div'));
    const doc = new TypstDocument('Hello world\n');
    const view = createVisualEditor(parent, doc);
    view.reveal(SourceRange.of({ from: 6, to: 11 }));
    const editable = parent.querySelector<HTMLElement>('[contenteditable]')!;
    press(editable, 'S', true);
    expect(doc.text).toBe('Hello #strike[world]\n');
  });
});
