// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { TypstDocument } from '../document/typst-document';
import { VisualView } from './visual-view';

function setup(text: string) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const doc = new TypstDocument(text);
  const view = new VisualView(parent, doc);
  const editable = parent.querySelector<HTMLElement>('[contenteditable]')!;
  return { doc, view, editable };
}

function press(target: HTMLElement, key: string, mod = true) {
  const isMac = /Mac/.test(navigator.platform);
  const event = new KeyboardEvent('keydown', { key, metaKey: mod && isMac, ctrlKey: mod && !isMac, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

describe('VisualView keyboard shortcuts', () => {
  it('handles Mod-b itself instead of letting the browser act', () => {
    const { editable } = setup('Hello\n');
    editable.focus();
    const event = press(editable, 'b');
    expect(event.defaultPrevented).toBe(true);
  });
});
