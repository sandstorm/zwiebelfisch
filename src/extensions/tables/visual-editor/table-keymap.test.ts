// @vitest-environment jsdom
// Tests for Tab and Shift+Tab in a table of the Visual editor (Tiptap's table keymap, with the other built-ins).
import { describe, expect, it } from 'vitest';
import { SourceRange, TypstDocument } from '../../../core/typst-document/typst-document';
import { createVisualEditor } from '../../../testing/testing';

describe('Tab in a table of the Visual editor', () => {
  it('moves to the next cell, Shift+Tab back; Tab in the last cell adds a row', () => {
    const parent = document.body.appendChild(document.createElement('div'));
    const source = '#table(columns: 2, [a], [b])\n';
    const doc = new TypstDocument(source);
    const view = createVisualEditor(parent, doc);
    view.reveal(SourceRange.of({ from: source.indexOf('[a]') + 1, to: source.indexOf('[a]') + 1 }));
    const editable = parent.querySelector<HTMLElement>('[contenteditable]')!;
    const tab = (shiftKey = false) => !editable.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true }));
    expect(tab()).toBe(true);
    expect(view.selection().from).toBe(source.indexOf('[b]') + 1);
    expect(tab(true)).toBe(true);
    expect(view.selection().from).toBe(source.indexOf('[a]') + 1);
    tab();
    expect(tab()).toBe(true);
    expect(doc.text.match(/\[\]/g)).toHaveLength(2);
  });
});

describe('Cut with nothing selected in a table of the Visual editor', () => {
  it('cuts the cell\'s text, not the cell', () => {
    const parent = document.body.appendChild(document.createElement('div'));
    const source = '#table(columns: 2, [a], [b])\n';
    const doc = new TypstDocument(source);
    createVisualEditor(parent, doc).reveal(SourceRange.of({ from: source.indexOf('[a]') + 1, to: source.indexOf('[a]') + 1 }));
    const data = new Map<string, string>();
    const cut = new Event('cut', { bubbles: true, cancelable: true });
    Object.defineProperty(cut, 'clipboardData', { value: { setData: (type: string, text: string) => data.set(type, text), getData: (type: string) => data.get(type) ?? '', clearData: () => data.clear() } });
    parent.querySelector('[contenteditable]')!.dispatchEvent(cut);
    expect(data.get('text/plain')).toBe('a');
    expect(doc.text).toBe('#table(columns: 2, [], [b])\n');
  });
});
