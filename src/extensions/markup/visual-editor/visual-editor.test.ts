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
