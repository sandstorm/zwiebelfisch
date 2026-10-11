// @vitest-environment jsdom
// Tests for the custom styles' entries of the text style menu and the style applier (visual-editor.ts), through the Visual editor.
import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '../../../core/event-emitter/event-emitter';
import { SourceRange, TypstDocument } from '../../../core/typst-document/typst-document';
import { calculateImportChange } from '../../../core/typst-syntax/typst-syntax';
import type { ProjectStyles } from '../model/typst-style-index';
import type { TypstStyle } from '../model/discover';
import { createVisualEditor } from '../../../testing/testing';
import { VisualEditor, VisualEditorHost } from '../../../hosts/visual-editor/visual-editor';
import { ProjectPath } from '../../../core/paths/paths';
import { customStyles, styleApplier } from './visual-editor';

const path = ProjectPath.of;

// jsdom lacks layout; ProseMirror only needs these to exist.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

const NOTE: TypstStyle = { name: 'note', kind: 'block', label: 'Note', path: path('/styles.typ') };
const KEY: TypstStyle = { name: 'key', kind: 'inline', label: 'Keyword', path: path('/styles.typ') };

function setup(text: string, initial: TypstStyle[] = [NOTE, KEY], create = () => {}) {
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
  const view = createVisualEditor(parent, doc, { contributions: [customStyles({ styles, create })] });
  const menu = parent.querySelector<HTMLSelectElement>('select[aria-label="Text style"]')!;
  const choose = (value: string) => {
    menu.value = value;
    menu.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const declare = (next: TypstStyle[]) => {
    list = next;
    changed.fire();
  };
  const labels = () => [...menu.querySelectorAll('optgroup')].map((g) => [g.label, ...[...g.querySelectorAll('option')].map((o) => o.text)]);
  return { doc, view, menu, choose, declare, labels, parent };
}

describe('custom styles in the text style menu', () => {
  it('lists the block and the inline styles after the headings, and New style…', () => {
    const { menu, labels } = setup('Text\n', [NOTE, KEY]);
    expect(labels()).toEqual([['Block styles', 'Note'], ['Inline styles', 'Keyword']]);
    expect([...menu.options].map((o) => o.value)).toEqual(['paragraph', 'heading-1', 'heading-2', 'heading-3', 'block:note', 'inline:key', 'new-style']);
  });

  it('a block style wraps the paragraph and is imported once; Normal text unwraps it', () => {
    const { doc, view, menu, choose } = setup('One\n\nTwo\n');
    view.reveal(SourceRange.of({ from: 1, to: 1 }));
    choose('block:note');
    expect(doc.text).toBe('#import "styles.typ": note\n\n#note[One]\n\nTwo\n');
    expect(menu.value).toBe('block:note');
    view.reveal(SourceRange.of({ from: doc.text.indexOf('Two'), to: doc.text.indexOf('Two') }));
    choose('block:note');
    expect(doc.text).toBe('#import "styles.typ": note\n\n#note[One]\n\n#note[Two]\n');
    view.reveal(SourceRange.of({ from: doc.text.indexOf('One'), to: doc.text.indexOf('One') }));
    expect([...menu.options].find((o) => o.value === 'paragraph')!.disabled).toBe(false);
    choose('paragraph');
    expect(doc.text).toBe('#import "styles.typ": note\n\nOne\n\n#note[Two]\n');
    expect(menu.value).toBe('paragraph');
  });

  it('an inline style toggles on the selection, marked ✓ where it is on', () => {
    const { doc, view, menu, choose } = setup('#import "styles.typ": note\n\nA term here\n');
    const from = doc.text.indexOf('term');
    view.reveal(SourceRange.of({ from: from, to: from + 4 }));
    choose('inline:key');
    expect(doc.text).toBe('#import "styles.typ": note, key\n\nA #key[term] here\n');
    const option = [...menu.options].find((o) => o.value === 'inline:key')!;
    expect(option.text).toBe('✓ Keyword');
    choose('inline:key');
    expect(doc.text).toBe('#import "styles.typ": note, key\n\nA term here\n');
  });

  it('an inline style needs a selection', () => {
    const { view, menu } = setup('A term\n');
    view.reveal(SourceRange.of({ from: 2, to: 2 }));
    expect([...menu.options].find((o) => o.value === 'inline:key')!.disabled).toBe(true);
  });

  it('follows the declared styles: a call shows styled once its style is declared', () => {
    const { parent, declare, labels } = setup('#note[Hi]\n', []);
    expect(parent.querySelector('.typst-styles__block')).toBeNull();
    expect(labels()).toEqual([]);
    declare([NOTE]);
    expect(parent.querySelector('.typst-styles__block')?.getAttribute('data-style-title')).toBe('Note');
    expect(parent.querySelector('.typst-styles__block p')?.textContent).toBe('Hi');
    expect(labels()).toEqual([['Block styles', 'Note']]);
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
    const contributions = VisualEditorHost.from([customStyles({ styles, create: () => {} })]);
    const parent = document.body.appendChild(document.createElement('div'));
    new VisualEditor(parent, new TypstDocument('Text\n'), contributions);
    const menu = parent.querySelector<HTMLSelectElement>('select[aria-label="Text style"]')!;
    expect([...menu.options].map((o) => o.value)).toEqual(['paragraph', 'block:note', 'new-style']);
  });
});

describe('styleApplier', () => {
  it("applies a style to the selection of a document's Visual editor as the menu does; false where it cannot", () => {
    const styles: ProjectStyles = {
      styles: () => [NOTE, KEY],
      onDidChange: new EventEmitter<void>().event,
      calculateImportChange: (document, style, use) =>
        calculateImportChange(document.text, { name: style.name, matches: (m) => m === 'styles.typ', create: () => `#import "styles.typ": ${style.name}\n\n`, use }),
    };
    const applier = styleApplier(styles);
    const doc = new TypstDocument('One\n');
    const parent = document.body.appendChild(document.createElement('div'));
    const view = createVisualEditor(parent, doc, { contributions: [customStyles({ styles, create: () => {} }), applier] });
    view.reveal(SourceRange.of({ from: 1, to: 1 }));
    expect(applier.apply(doc, KEY)).toBe(false);
    expect(applier.apply(doc, NOTE)).toBe(true);
    expect(doc.text).toBe('#import "styles.typ": note\n\n#note[One]\n');
    expect(applier.apply(new TypstDocument('Other\n'), NOTE)).toBe(false);
  });
});
