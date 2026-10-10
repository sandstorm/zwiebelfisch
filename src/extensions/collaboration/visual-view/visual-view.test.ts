// @vitest-environment jsdom
// Tests for visual-view.ts (and box-carets.ts): other users' places drawn in a Visual view and in its boxes.
import { describe, expect, it } from 'vitest';
import { TypstDocument } from '../../../core/typst-document/typst-document';
import { createVisualView } from '../../../testing/testing';
import { presence } from './visual-view';

/** A Visual view with the built-ins (the boxes and cells the tests put carets in) and the presence contribution. */
function setup(text: string) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const doc = new TypstDocument(text);
  const view = createVisualView(parent, doc, { contributions: [presence] });
  return { doc, view, parent };
}

const ann = { id: '1', user: { name: 'Ann', color: '#b58900' } };
const bob = { id: '2', user: { name: 'Bob', color: '#6c71c4' } };
const at = (offset: number) => ({ anchor: offset, head: offset });

/** The text of the textblock a caret is in, before the caret. */
function textBefore(caret: Element): string {
  const block = caret.closest('p, h1, h2, h3, li, pre')!;
  const range = document.createRange();
  range.setStart(block, 0);
  range.setEndBefore(caret);
  return range.toString();
}

describe('VisualView presence', () => {
  it('draws a caret widget with the name flag at the position', () => {
    const source = 'Some bold text\n';
    const { view, parent } = setup(source);
    view.setPresence([{ ...ann, ...at(source.indexOf('bold')) }]);
    const caret = parent.querySelector<HTMLElement>('.typst-remote-caret')!;
    expect(caret.dataset.user).toBe('Ann');
    expect(caret.querySelector('.typst-remote-caret__flag')!.textContent).toBe('Ann');
    expect(caret.style.getPropertyValue('--typst-remote-color')).toBe('#b58900');
    expect(textBefore(caret)).toBe('Some ');
  });

  it('a caret at the end of a line stays there (not at the start of the next line)', () => {
    const source = '= Title\n\nFirst line\nsecond line\n\nNext paragraph\n';
    const { view, parent } = setup(source);
    const caretAt = (offset: number) => {
      view.setPresence([{ ...ann, ...at(offset) }]);
      const caret = parent.querySelector('.typst-remote-caret')!;
      return { block: caret.closest('p, h1')!.textContent!.replace('Ann', ''), before: textBefore(caret).replace('Ann', '') };
    };
    expect(caretAt(source.indexOf('\n'))).toEqual({ block: 'Title', before: 'Title' });
    expect(caretAt(source.indexOf('First line') + 'First line'.length)).toMatchObject({ before: 'First line' });
    expect(caretAt(source.indexOf('second line') + 'second line'.length)).toEqual({ block: 'First line second line', before: 'First line second line' });
    // and the start of a line stays at the start
    expect(caretAt(source.indexOf('Next'))).toEqual({ block: 'Next paragraph', before: '' });
    expect(caretAt(source.indexOf('Title'))).toEqual({ block: 'Title', before: '' });
  });

  it('draws a caret in an empty paragraph (an empty table cell)', () => {
    const source = '#table(columns: 2, [a], [])\n';
    const { view, parent } = setup(source);
    view.setPresence([{ ...ann, ...at(source.indexOf('[]') + 1) }]);
    const caret = parent.querySelector('.typst-remote-caret');
    expect(caret).not.toBeNull();
    expect(caret!.closest('p')?.textContent).toBe('Ann');
    expect(caret!.closest('td')).toBe(parent.querySelectorAll('td')[1]);
  });

  it('draws a caret in an empty paragraph made in this view (Enter: the text only has a blank line more)', () => {
    const { doc, view, parent } = setup('One\n\nTwo\n');
    view.reveal(5, 5);
    parent.querySelector('[contenteditable]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(doc.text).toBe('One\n\n\n\nTwo\n');
    view.setPresence([{ ...ann, ...at(4) }]);
    expect([...parent.querySelectorAll('p')].map((p) => p.textContent)).toEqual(['One', 'Ann', 'Two']);
  });

  it('tints the selection; carets follow edits from elsewhere and go when cleared', () => {
    const source = 'Some bold text\n';
    const { doc, view, parent } = setup(source);
    view.setPresence([{ ...ann, anchor: 5, head: 9 }]);
    expect(parent.querySelector('.typst-remote-selection[data-user="Ann"]')?.textContent).toBe('bold');
    doc.setText(`Really. ${source}`, 'source');
    expect(textBefore(parent.querySelector('.typst-remote-caret')!)).toBe('Really. Some bold');
    view.setPresence([]);
    expect(parent.querySelector('.typst-remote-caret, .typst-remote-selection')).toBeNull();
  });

  it('outlines a raw box with a caret inside, naming everyone there, and draws the carets in its code', () => {
    const source = 'Intro\n\n#set page(width: 10cm)\n\nText\n';
    const { view, parent } = setup(source);
    const box = source.indexOf('#set');
    view.setPresence([{ ...ann, ...at(box + 4) }, { ...bob, ...at(box + 1) }]);
    const outlined = parent.querySelector<HTMLElement>('.typst-visual__raw-block.typst-remote-box')!;
    expect(outlined.dataset.user).toBe('Ann, Bob');
    expect(outlined.style.getPropertyValue('--typst-remote-color')).toBe('#b58900');
    expect(outlined.style.getPropertyValue('--typst-remote-text')).toBe('#000000');
    expect(parent.querySelector('p .typst-remote-caret')).toBeNull();
    const inCode = [...outlined.querySelectorAll<HTMLElement>('.cm-line .typst-remote-caret')];
    expect(inCode.map((caret) => caret.dataset.user).sort()).toEqual(['Ann', 'Bob']);
  });

  it('outlines an image box; a caret right before an inline box stays a caret', () => {
    const source = 'Text #box[x] more\n\n#image("a.png")\n';
    const { view, parent } = setup(source);
    view.setPresence([{ ...ann, ...at(source.indexOf('image') + 3) }, { ...bob, ...at(source.indexOf('#box')) }]);
    expect(parent.querySelector('.typst-visual__image.typst-remote-box')?.getAttribute('data-user')).toBe('Ann');
    expect(parent.querySelector('.typst-visual__raw-inline.typst-remote-box')).toBeNull();
    expect(parent.querySelector('p .typst-remote-caret[data-user="Bob"]')).not.toBeNull();
  });

  it('outlines an inline raw box with a caret strictly inside', () => {
    const source = 'Text #box[x] more\n';
    const { view, parent } = setup(source);
    view.setPresence([{ ...bob, ...at(source.indexOf('box')) }]);
    expect(parent.querySelector('.typst-visual__raw-inline.typst-remote-box')?.getAttribute('data-user')).toBe('Bob');
  });
});
