// @vitest-environment jsdom
// Tests for the markup extension's Visual-view keymap.
import { describe, expect, it } from 'vitest';
import { TypstDocument } from '../../../core/typst-document/typst-document';
import { VisualView, VisualViewContributions } from '../../../hosts/visual-view/visual-view';
import { markup } from '../markup';

function press(target: HTMLElement, key: string) {
  const mac = /Mac/.test(navigator.platform);
  const event = new KeyboardEvent('keydown', { key, metaKey: mac, ctrlKey: !mac, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

describe('markup in a Visual view', () => {
  it('handles Mod-b and Mod-i itself instead of letting the browser act', () => {
    const parent = document.body.appendChild(document.createElement('div'));
    new VisualView(parent, new TypstDocument('Hello\n'), VisualViewContributions.from([markup]));
    const editable = parent.querySelector<HTMLElement>('[contenteditable]')!;
    editable.focus();
    expect(press(editable, 'b').defaultPrevented).toBe(true);
    expect(press(editable, 'i').defaultPrevented).toBe(true);
  });
});
