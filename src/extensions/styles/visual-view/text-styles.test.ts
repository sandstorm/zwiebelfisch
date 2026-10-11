// @vitest-environment jsdom
// Tests for the custom styles' entries of the text style menu (visual-view.ts), through the Visual view.
import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '../../../core/event-emitter/event-emitter';
import { TypstDocument } from '../../../core/typst-document/typst-document';
import { calculateImportChange } from '../../../core/typst-syntax/typst-syntax';
import type { ProjectStyles } from '../model/style-index';
import type { Style } from '../model/discover';
import { createVisualView } from '../../../testing/testing';
import { VisualView, VisualViewHost } from '../../../hosts/visual-view/visual-view';
import { ProjectPath } from '../../../core/paths/paths';
import { customStyles } from './visual-view';

const path = ProjectPath.of;

// jsdom lacks layout; ProseMirror only needs these to exist.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

const NOTE: Style = { name: 'note', kind: 'paragraph', label: 'Note', path: path('/styles.typ') };
const KEY: Style = { name: 'key', kind: 'text', label: 'Keyword', path: path('/styles.typ') };

function setup(text: string, initial: Style[] = [NOTE, KEY], create = () => {}) {
  let list = initial;
  const changed = new EventEmitter<void>();
  const styles: ProjectStyles = {
    styles: () => list,
    onDidChange: changed.event,
    calculateImportChange: (document, style, use) =>
      calculateImportChange(document.text, { name: style.name, matches: (m) => m === 'styles.typ', create: () => `#import "styles.typ": ${style.name}\n\n`, use }),
  };
  const parent = document.createElement('div');
  document.body.append(parent);
  const doc = new TypstDocument(text);
  const view = createVisualView(parent, doc, { contributions: [customStyles({ styles, create })] });
  const menu = parent.querySelector<HTMLSelectElement>('select[aria-label="Text style"]')!;
  const choose = (value: string) => {
    menu.value = value;
    menu.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const declare = (next: Style[]) => {
    list = next;
    changed.fire();
  };
  const labels = () => [...menu.querySelectorAll('optgroup')].map((g) => [g.label, ...[...g.querySelectorAll('option')].map((o) => o.text)]);
  return { doc, view, menu, choose, declare, labels, parent };
}

describe('custom styles in the text style menu', () => {
  it('lists the paragraph and the text styles after the headings, and New style…', () => {
    const { menu, labels } = setup('Text\n', [NOTE, KEY]);
    expect(labels()).toEqual([['Paragraph styles', 'Note'], ['Text styles', 'Keyword']]);
    expect([...menu.options].map((o) => o.value)).toEqual(['paragraph', 'heading-1', 'heading-2', 'heading-3', 'paragraph:note', 'text:key', 'new-style']);
  });

  it('a paragraph style wraps the paragraph and is imported once; Normal text unwraps it', () => {
    const { doc, view, menu, choose } = setup('One\n\nTwo\n');
    view.reveal(1, 1);
    choose('paragraph:note');
    expect(doc.text).toBe('#import "styles.typ": note\n\n#note[One]\n\nTwo\n');
    expect(menu.value).toBe('paragraph:note');
    view.reveal(doc.text.indexOf('Two'), doc.text.indexOf('Two'));
    choose('paragraph:note');
    expect(doc.text).toBe('#import "styles.typ": note\n\n#note[One]\n\n#note[Two]\n');
    view.reveal(doc.text.indexOf('One'), doc.text.indexOf('One'));
    choose('paragraph');
    expect(doc.text).toBe('#import "styles.typ": note\n\nOne\n\n#note[Two]\n');
    expect(menu.value).toBe('paragraph');
  });

  it('a text style toggles on the selection, marked ✓ where it is on', () => {
    const { doc, view, menu, choose } = setup('#import "styles.typ": note\n\nA term here\n');
    const from = doc.text.indexOf('term');
    view.reveal(from, from + 4);
    choose('text:key');
    expect(doc.text).toBe('#import "styles.typ": note, key\n\nA #key[term] here\n');
    const option = [...menu.options].find((o) => o.value === 'text:key')!;
    expect(option.text).toBe('✓ Keyword');
    choose('text:key');
    expect(doc.text).toBe('#import "styles.typ": note, key\n\nA term here\n');
  });

  it('a text style needs a selection', () => {
    const { view, menu } = setup('A term\n');
    view.reveal(2, 2);
    expect([...menu.options].find((o) => o.value === 'text:key')!.disabled).toBe(true);
  });

  it('follows the declared styles: a call shows styled once its style is declared', () => {
    const { parent, declare, labels } = setup('#note[Hi]\n', []);
    expect(parent.querySelector('.typst-styles__block')).toBeNull();
    expect(labels()).toEqual([]);
    declare([NOTE]);
    expect(parent.querySelector('.typst-styles__block')?.getAttribute('data-style-title')).toBe('Note');
    expect(parent.querySelector('.typst-styles__block p')?.textContent).toBe('Hi');
    expect(labels()).toEqual([['Paragraph styles', 'Note']]);
  });

  it('New style… asks the host to create one', () => {
    const create = vi.fn();
    const { choose } = setup('Text\n', [NOTE], create);
    choose('new-style');
    expect(create).toHaveBeenCalled();
  });
});

describe('the text style menu without headings', () => {
  it('offers normal text and the styles, but no heading levels, when no extension contributes headings', () => {
    const styles: ProjectStyles = { styles: () => [NOTE], onDidChange: new EventEmitter<void>().event, calculateImportChange: () => null };
    const contributions = VisualViewHost.from([customStyles({ styles, create: () => {} })]);
    const parent = document.body.appendChild(document.createElement('div'));
    new VisualView(parent, new TypstDocument('Text\n'), contributions);
    const menu = parent.querySelector<HTMLSelectElement>('select[aria-label="Text style"]')!;
    expect([...menu.options].map((o) => o.value)).toEqual(['paragraph', 'paragraph:note', 'new-style']);
  });
});
