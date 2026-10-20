// @vitest-environment jsdom
// Tests for the custom styles' entries of the text style menu, the Styles menu of the selection bar and the style applier (visual-editor.ts), through the Visual editor.
import simpleStyles from '../../../../demo/examples/simple/styles.typ?raw';
import type { Editor } from '@tiptap/core';
import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '../../../core/event-emitter/event-emitter';
import { SourceRange, TypstDocument } from '../../../core/typst-document/typst-document';
import { calculateImportChange } from '../../../core/typst-syntax/typst-syntax';
import type { ProjectStyles } from '../model/typst-style-index';
import { scanStyles, type TypstStyle } from '../model/discover';
import { blockHandle, createVisualEditor, dragStart, drop, testHosts, visualEditorExtension } from '../../../testing/testing';
import { VisualEditor } from '../../../hosts/visual-editor/visual-editor';
import { ProjectPath } from '../../../core/paths/paths';
import { registerCustomStyles, registerStyleApplier, type StyleApplier } from './visual-editor';

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
  const view = createVisualEditor(parent, doc, { contributions: [visualEditorExtension((_, context) => registerCustomStyles(context, { styles, create }))] });
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
    menu.dispatchEvent(new MouseEvent('mousedown'));
    const option = [...menu.options].find((o) => o.value === 'inline:key')!;
    expect(option.text).toBe('✓ Keyword');
    choose('inline:key');
    expect(doc.text).toBe('#import "styles.typ": note, key\n\nA term here\n');
  });

  it('an inline style needs a selection', () => {
    const { view, menu } = setup('A term\n');
    view.reveal(SourceRange.of({ from: 2, to: 2 }));
    menu.dispatchEvent(new MouseEvent('mousedown'));
    expect([...menu.options].find((o) => o.value === 'inline:key')!.disabled).toBe(true);
  });

  it('follows the declared styles: a call shows styled once its style is declared', () => {
    const { parent, declare, labels } = setup('#note[Hi]\n', []);
    expect(parent.querySelector('.zwf-styles__block')).toBeNull();
    expect(labels()).toEqual([]);
    declare([NOTE]);
    expect(parent.querySelector('.zwf-styles__block')?.getAttribute('data-style-title')).toBe('Note');
    expect(parent.querySelector('.zwf-styles__block p')?.textContent).toBe('Hi');
    expect(labels()).toEqual([['Block styles', 'Note']]);
  });

  it('New style… asks the host to create one', () => {
    const create = vi.fn();
    const { choose } = setup('Text\n', [NOTE], create);
    choose('new-style');
    expect(create).toHaveBeenCalled();
  });
});

describe('the Styles menu of the selection bar', () => {
  /** The simple demo example's styles: block Tip, inline Key. */
  const SIMPLE = scanStyles(simpleStyles).map((style) => ({ ...style, path: path('/styles.typ') }));
  const bar = (parent: HTMLElement) => parent.querySelector<HTMLElement>('[role="toolbar"][aria-label="Selection"]')!;
  const stylesMenu = (parent: HTMLElement) => bar(parent).querySelector<HTMLButtonElement>('button[aria-label="Styles"]');
  const items = (parent: HTMLElement) => [...bar(parent).querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
  /** Opens the menu afresh (closes it first when open). */
  const open = (parent: HTMLElement) => {
    if (stylesMenu(parent)!.getAttribute('aria-expanded') === 'true') stylesMenu(parent)!.click();
    stylesMenu(parent)!.click();
    return items(parent);
  };

  it('lists the inline styles of the simple example (Key), not the block styles', () => {
    const { parent, view, doc } = setup('A term here\n', SIMPLE);
    view.reveal(SourceRange.of({ from: doc.text.indexOf('term'), to: doc.text.indexOf('term') + 4 }));
    expect(stylesMenu(parent)!.closest<HTMLElement>('.zwf-toolbar__menu')!.hidden).toBe(false);
    expect(open(parent).map((item) => item.getAttribute('aria-label'))).toEqual(['Key']);
  });

  it('toggles an inline style on the selection as the text style menu does: wraps, imports, shows it pressed, unwraps', () => {
    const { parent, view, doc } = setup('#import "styles.typ": note\n\nA term here\n');
    const from = doc.text.indexOf('term');
    view.reveal(SourceRange.of({ from, to: from + 4 }));
    const [key] = open(parent);
    expect(key.getAttribute('aria-pressed')).toBe('false');
    key.click();
    expect(doc.text).toBe('#import "styles.typ": note, key\n\nA #key[term] here\n');
    expect(open(parent)[0].getAttribute('aria-pressed')).toBe('true');
    open(parent)[0].click();
    expect(doc.text).toBe('#import "styles.typ": note, key\n\nA term here\n');
  });

  it('is left out while the project has no inline styles, and follows the styles as they are declared', () => {
    const { parent, view, doc, declare } = setup('A term here\n', [NOTE]);
    view.reveal(SourceRange.of({ from: 2, to: 6 }));
    expect(stylesMenu(parent)!.closest<HTMLElement>('.zwf-toolbar__menu')!.hidden).toBe(true);
    declare([NOTE, KEY]);
    view.reveal(SourceRange.of({ from: 2, to: doc.text.indexOf(' here') }));
    expect(stylesMenu(parent)!.closest<HTMLElement>('.zwf-toolbar__menu')!.hidden).toBe(false);
    expect(open(parent).map((item) => item.getAttribute('aria-label'))).toEqual(['Keyword']);
  });
});

describe('the text style menu without headings', () => {
  it('offers normal text and the styles, but no heading levels, when no extension contributes headings', () => {
    const styles: ProjectStyles = { styles: () => [NOTE], onDidChange: new EventEmitter<void>().event, calculateImportChange: () => null };
    const hosts = testHosts();
    const contributions = hosts.visualEditor;
    registerCustomStyles(hosts, { styles, create: () => {} });
    const parent = document.body.appendChild(document.createElement('div'));
    new VisualEditor(parent, new TypstDocument('Text\n'), contributions);
    const menu = parent.querySelector<HTMLSelectElement>('select[aria-label="Text style"]')!;
    expect([...menu.options].map((o) => o.value)).toEqual(['paragraph', 'block:note', 'new-style']);
  });
});

describe('registerStyleApplier', () => {
  it("applies a style to the selection of a document's Visual editor as the menu does; false where it cannot", () => {
    const styles: ProjectStyles = {
      styles: () => [NOTE, KEY],
      onDidChange: new EventEmitter<void>().event,
      calculateImportChange: (document, style, use) =>
        calculateImportChange(document.text, { name: style.name, matches: (m) => m === 'styles.typ', create: () => `#import "styles.typ": ${style.name}\n\n`, use }),
    };
    let applier!: StyleApplier;
    const doc = new TypstDocument('One\n');
    const parent = document.body.appendChild(document.createElement('div'));
    const view = createVisualEditor(parent, doc, { contributions: [visualEditorExtension((_, context) => registerCustomStyles(context, { styles, create: () => {} })), visualEditorExtension((visualEditor) => (applier = registerStyleApplier(visualEditor, styles)))] });
    view.reveal(SourceRange.of({ from: 1, to: 1 }));
    expect(applier.apply(doc, KEY)).toBe(false);
    expect(applier.apply(doc, NOTE)).toBe(true);
    expect(doc.text).toBe('#import "styles.typ": note\n\n#note[One]\n');
    expect(applier.apply(new TypstDocument('Other\n'), NOTE)).toBe(false);
  });
});

describe('block styles in the Visual editor', () => {
  it('a styled block moves by its handle with its call verbatim, in one undo step', () => {
    const text = '#note(kind: "tip")[A *noted* paragraph.]\n\nAfter\n';
    const { doc, parent } = setup(text);
    const tiptap = (parent.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor;
    const { view } = tiptap;
    // the pointer beside the paragraph in the style: the handle is the style's, with all in it
    dragStart(blockHandle(view, 2));
    drop(view, parent.querySelector('p:last-child')!, view.state.doc.content.size);
    expect(doc.text).toBe('After\n\n#note(kind: "tip")[A *noted* paragraph.]\n');
    tiptap.commands.undo();
    expect(doc.text).toBe(text);
  });
});
