// @vitest-environment jsdom
// Tests for text-align.ts.
import { describe, expect, it } from 'vitest';
import { SourceRange, TypstDocument } from '../../../core/typst-document/typst-document';
import { createVisualEditor, opened } from '../../../testing/testing';

const LABELS = { left: 'Align left', center: 'Center', right: 'Align right', justify: 'Justify' } as const;
type Alignment = keyof typeof LABELS;

function setup(text: string) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const doc = new TypstDocument(text);
  const view = createVisualEditor(parent, doc);
  const button = (alignment: Alignment) => parent.querySelector<HTMLButtonElement>(`button[aria-label="${LABELS[alignment]}"]`)!;
  const pressed = () => (Object.keys(LABELS) as Alignment[]).filter((a) => opened(button(a)).getAttribute('aria-pressed') === 'true');
  /** Puts the cursor into (or selects from..to of) the source text `needle`. */
  const select = (needle: string, length = 0) => {
    const at = doc.text.indexOf(needle);
    view.reveal(SourceRange.of({ from: at, to: at + length }));
  };
  const changes: number[] = [];
  doc.onDidChange(() => changes.push(changes.length));
  return { doc, view, parent, button, pressed, select, changes };
}

function textAlign(parent: HTMLElement, text: string): string {
  const block = [...parent.querySelectorAll<HTMLElement>('.typst-visual p, .typst-visual h1, .typst-visual h2')].find((e) => e.textContent === text)!;
  return block.style.textAlign || 'left';
}

describe('text alignment commands', () => {
  it('centers a paragraph by wrapping it, and left removes the wrapper again', () => {
    const { doc, parent, button, pressed, select } = setup('First\n\nSecond *bold*\n');
    select('Second');
    expect(pressed()).toEqual(['left']);
    button('center').click();
    expect(doc.text).toBe('First\n\n#align(center)[Second *bold*]\n');
    expect(pressed()).toEqual(['center']);
    expect(textAlign(parent, 'Second bold')).toBe('center');
    button('right').click();
    expect(doc.text).toBe('First\n\n#align(right)[Second *bold*]\n');
    button('left').click();
    expect(doc.text).toBe('First\n\nSecond *bold*\n');
    expect(textAlign(parent, 'Second bold')).toBe('left');
  });

  it('wraps a selection of several blocks, headings and lists in one alignment block', () => {
    const { doc, button, select } = setup('= Title\n\nText\n\n- a\n- b\n');
    select('Title', doc.text.indexOf('- b') + 3 - doc.text.indexOf('Title'));
    button('center').click();
    expect(doc.text).toBe('#align(center)[= Title\n\nText\n\n- a\n- b]\n');
  });

  it('splits an alignment block when only part of it is set left', () => {
    const { doc, button, pressed, select } = setup('#align(center)[\n  A\n\n  B\n\n  C\n]\n');
    select('B');
    expect(pressed()).toEqual(['center']);
    button('left').click();
    expect(doc.text).toBe('#align(center)[\n  A\n]\n\nB\n\n#align(center)[\n  C\n]\n');
    expect(pressed()).toEqual(['left']);
  });

  it('merges a selection over aligned and plain blocks into one alignment block', () => {
    const { doc, button, select } = setup('A\n\n#align(right)[B]\n\nC\n');
    select('A', doc.text.length - 1);
    button('center').click();
    expect(doc.text).toBe('#align(center)[A\n\nB\n\nC]\n');
    button('left').click();
    expect(doc.text).toBe('A\n\nB\n\nC\n');
  });

  it('changes only the horizontal part of an existing alignment', () => {
    const { doc, button, select } = setup('#align(top + center)[Hi]\n\n#align(center)[\n  Two\n]\n');
    select('Hi');
    button('left').click();
    expect(doc.text).toBe('#align(top + left)[Hi]\n\n#align(center)[\n  Two\n]\n');
    select('Two');
    button('right').click();
    expect(doc.text).toBe('#align(top + left)[Hi]\n\n#align(right)[\n  Two\n]\n');
  });

  it('justifies a paragraph and toggles back', () => {
    const { doc, parent, button, pressed, select } = setup('Lorem ipsum\n');
    select('ipsum');
    button('justify').click();
    expect(doc.text).toBe('#par(justify: true)[Lorem ipsum]\n');
    expect(pressed()).toEqual(['justify']);
    expect(textAlign(parent, 'Lorem ipsum')).toBe('justify');
    button('center').click();
    expect(doc.text).toBe('#align(center)[Lorem ipsum]\n');
    button('justify').click();
    expect(doc.text).toBe('#par(justify: true)[Lorem ipsum]\n');
    button('left').click();
    expect(doc.text).toBe('Lorem ipsum\n');
  });

  it('justify leaves headings and list items alone', () => {
    const { doc, button, select } = setup('= Title\n\n- item\n');
    select('Title', doc.text.length - doc.text.indexOf('Title'));
    button('justify').click();
    expect(doc.text).toBe('= Title\n\n- item\n');
  });

  it('follows set rules: shows their alignment and only writes what differs', () => {
    const source = '#set align(center)\n#set par(justify: true)\n\n= Title\n\nBody\n';
    const { doc, parent, button, pressed, select } = setup(source);
    select('Title');
    expect(pressed()).toEqual(['center']);
    expect(textAlign(parent, 'Title')).toBe('center');
    select('Body');
    expect(pressed()).toEqual(['justify']);
    expect(textAlign(parent, 'Body')).toBe('justify');
    button('justify').click();
    expect(doc.text).toBe(source);
    button('center').click();
    expect(doc.text).toBe(source.replace('Body', '#par(justify: false)[Body]'));
    button('left').click();
    expect(doc.text).toBe(source.replace('Body', '#align(left)[#par(justify: false)[Body]]'));
    button('justify').click();
    expect(doc.text).toBe(source);
  });

  it('is one undo step per action', () => {
    const { doc, parent, select } = setup('A\n\nB\n');
    select('B');
    parent.querySelector<HTMLButtonElement>('button[aria-label="Center"]')!.click();
    parent.querySelector<HTMLButtonElement>('button[aria-label="Undo"]')!.click();
    expect(doc.text).toBe('A\n\nB\n');
  });

  it('has the shortcuts Mod-Shift-L/E/R/J', () => {
    const { doc, parent, select } = setup('Text\n');
    select('Text');
    const editable = parent.querySelector<HTMLElement>('[contenteditable]')!;
    const mac = /Mac/.test(navigator.platform);
    // with Shift, browsers report the upper-case key; ProseMirror matches it by key code
    const press = (key: string) =>
      editable.dispatchEvent(
        new KeyboardEvent('keydown', { key, keyCode: key.charCodeAt(0), shiftKey: true, metaKey: mac, ctrlKey: !mac, bubbles: true, cancelable: true }),
      );
    press('E');
    expect(doc.text).toBe('#align(center)[Text]\n');
    press('R');
    expect(doc.text).toBe('#align(right)[Text]\n');
    press('J');
    expect(doc.text).toBe('#par(justify: true)[Text]\n');
    press('L');
    expect(doc.text).toBe('Text\n');
  });

  it('changes the source with one minimal edit per action', () => {
    const source = 'Intro\n\nA long paragraph with *bold* and \\* escapes -- and more.\n\nOutro\n';
    const { doc, button, select, changes } = setup(source);
    select('long');
    button('center').click();
    expect(changes).toHaveLength(1);
    expect(doc.text).toBe(source.replace('A long', '#align(center)[A long').replace('more.', 'more.]'));
  });
});
