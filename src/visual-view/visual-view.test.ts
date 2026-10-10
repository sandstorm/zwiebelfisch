// @vitest-environment jsdom
import './jsdom-setup';
import { describe, expect, it } from 'vitest';
import { TypstDocument } from '../document/typst-document';
import { VisualView } from './visual-view';

function setup(text: string) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const doc = new TypstDocument(text);
  const view = new VisualView(parent, doc);
  const editable = parent.querySelector<HTMLElement>('[contenteditable]')!;
  return { doc, view, editable, parent };
}

function press(target: HTMLElement, key: string) {
  const mac = /Mac/.test(navigator.platform);
  const event = new KeyboardEvent('keydown', { key, metaKey: mac, ctrlKey: !mac, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

describe('VisualView', () => {
  it('renders the projected document', () => {
    const { parent } = setup('= Title\n\nSome *bold* text.\n');
    expect(parent.querySelector('h1')?.textContent).toBe('Title');
    expect(parent.querySelector('strong')?.textContent).toBe('bold');
  });

  it('handles Mod-b and Mod-i itself instead of letting the browser act', () => {
    const { editable } = setup('Hello\n');
    editable.focus();
    expect(press(editable, 'b').defaultPrevented).toBe(true);
    expect(press(editable, 'i').defaultPrevented).toBe(true);
  });

  it('reveals a source range by selecting exactly what shows it', () => {
    const source = '= Title\n\nSome *bold* text.\n';
    const { view } = setup(source);
    view.reveal(source.indexOf('bold'), source.indexOf('bold') + 4);
    expect(window.getSelection()?.toString()).toBe('bold');
  });

  it('follows document changes made elsewhere', () => {
    const { doc, parent } = setup('= Title\n\nText\n');
    doc.setText('= Title\n\nText changed\n', 'source');
    expect(parent.querySelector('p')?.textContent).toBe('Text changed');
  });
});
