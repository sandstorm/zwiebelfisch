// @vitest-environment jsdom
// Tests for the lists' Tab and Shift+Tab in a Visual editor (with the other built-ins, as in the widget).
import { describe, expect, it } from 'vitest';
import { SourceRange, TypstDocument } from '../../../core/typst-document/typst-document';
import { createVisualEditor } from '../../../testing/testing';

/** A Visual editor of `source`, the caret at `offset`, and Tab (with Shift: `shift`) pressed in it: whether it was consumed. */
function setup(source: string, offset: number) {
  const parent = document.body.appendChild(document.createElement('div'));
  const doc = new TypstDocument(source);
  createVisualEditor(parent, doc).reveal(SourceRange.of({ from: offset, to: offset }));
  const editable = parent.querySelector<HTMLElement>('[contenteditable]')!;
  const tab = (shiftKey = false) => !editable.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true }));
  return { doc, tab };
}

describe('Tab in a list of the Visual editor', () => {
  it('nests the item, Shift+Tab takes it out again; the keys are consumed, so the focus stays', () => {
    const source = '- one\n- two\n';
    const { doc, tab } = setup(source, source.indexOf('two'));
    expect(tab()).toBe(true);
    expect(doc.text).toBe('- one\n  - two\n');
    expect(tab(true)).toBe(true);
    expect(doc.text).toBe(source);
  });

  it('consumes Tab in the first item, which cannot nest', () => {
    const source = '- one\n- two\n';
    const { doc, tab } = setup(source, 2);
    expect(tab()).toBe(true);
    expect(doc.text).toBe(source);
  });
});

describe('Cut with nothing selected in a list of the Visual editor', () => {
  it('cuts the item at the caret, its Typst on the clipboard', () => {
    const source = '- one\n- two\n- three\n';
    const parent = document.body.appendChild(document.createElement('div'));
    const doc = new TypstDocument(source);
    createVisualEditor(parent, doc).reveal(SourceRange.of({ from: source.indexOf('two'), to: source.indexOf('two') }));
    const data = new Map<string, string>();
    const cut = new Event('cut', { bubbles: true, cancelable: true });
    Object.defineProperty(cut, 'clipboardData', { value: { setData: (type: string, text: string) => data.set(type, text), getData: (type: string) => data.get(type) ?? '', clearData: () => data.clear() } });
    parent.querySelector('[contenteditable]')!.dispatchEvent(cut);
    expect(data.get('text/plain')).toBe('- two');
    expect(doc.text).toBe('- one\n- three\n');
  });
});
