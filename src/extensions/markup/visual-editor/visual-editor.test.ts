// @vitest-environment jsdom
// Tests for the markup extension's Visual-editor keymap (with the other built-ins, as in the widget).
import { describe, expect, it } from 'vitest';
import { SourceRange, TypstDocument } from '../../../core/typst-document/typst-document';
import { createVisualEditor } from '../../../testing/testing';

function press(target: HTMLElement, key: string) {
  const mac = /Mac/.test(navigator.platform);
  const event = new KeyboardEvent('keydown', { key, metaKey: mac, ctrlKey: !mac, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

describe('markup in a Visual editor', () => {
  it('handles Mod-b, Mod-i and Mod-u itself instead of letting the browser act', () => {
    const parent = document.body.appendChild(document.createElement('div'));
    createVisualEditor(parent, new TypstDocument('Hello\n'));
    const editable = parent.querySelector<HTMLElement>('[contenteditable]')!;
    editable.focus();
    expect(press(editable, 'b').defaultPrevented).toBe(true);
    expect(press(editable, 'i').defaultPrevented).toBe(true);
    expect(press(editable, 'u').defaultPrevented).toBe(true);
  });

  it('leaves inline code, code blocks and raw boxes out of spell checking', () => {
    const parent = document.body.appendChild(document.createElement('div'));
    createVisualEditor(parent, new TypstDocument('Some `kode` and $x$\n\n```js\nlet wrod\n```\n'));
    expect(parent.querySelector('.typst-markup__code-inline')?.getAttribute('spellcheck')).toBe('false');
    expect(parent.querySelector('.typst-markup__code-block')?.getAttribute('spellcheck')).toBe('false');
    expect(parent.querySelector('.typst-visual__raw-inline .cm-content')?.getAttribute('spellcheck')).toBe('false');
  });

  it('Mod-u underlines the selection', () => {
    const parent = document.body.appendChild(document.createElement('div'));
    const doc = new TypstDocument('Hello world\n');
    const view = createVisualEditor(parent, doc);
    view.reveal(SourceRange.of({ from: 6, to: 11 }));
    press(parent.querySelector<HTMLElement>('[contenteditable]')!, 'u');
    expect(doc.text).toBe('Hello #underline[world]\n');
  });
});
