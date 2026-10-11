// @vitest-environment jsdom
// Tests for editing-views.ts.
import { describe, expect, it } from 'vitest';
import { TypstDocument } from '../../../core/typst-document/typst-document';
import { VisualViewContributions } from '../../visual-view/visual-view';
import { EditingViews } from './editing-views';

// jsdom lacks layout; ProseMirror and CodeMirror only need these to exist.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();
Element.prototype.scrollIntoView = () => {};

function setup(mode?: 'visual' | 'source') {
  const parent = document.createElement('div');
  document.body.append(parent);
  const views = new EditingViews(parent, { mode, visualView: VisualViewContributions.from([]) });
  const a = new TypstDocument('Alpha\n');
  const b = new TypstDocument('Beta\n');
  const visible = () => [...parent.querySelectorAll<HTMLElement>('.typst-editor__pane')].filter((p) => !p.hidden);
  const tab = (name: string) => [...parent.querySelectorAll<HTMLElement>('[role=tab]')].find((t) => t.textContent === name)!;
  return { parent, views, a, b, visible, tab };
}

describe('EditingViews', () => {
  it('renders the tabs and one pair of panes per document, as the single-file widget did', () => {
    const { parent, views, a } = setup();
    views.show(a);
    expect([...parent.children].map((c) => c.className)).toEqual([
      'typst-editor__tabs',
      'typst-editor__pane',
      'typst-editor__pane',
    ]);
    expect(parent.querySelector('.typst-visual p')?.textContent).toBe('Alpha');
  });

  it('creates the views of a document only when it is first shown', () => {
    const { parent, views, a, b, visible } = setup();
    views.show(a);
    expect(parent.querySelectorAll('.typst-editor__pane')).toHaveLength(2);
    views.show(b);
    expect(parent.querySelectorAll('.typst-editor__pane')).toHaveLength(4);
    expect(visible()).toHaveLength(1);
    expect(visible()[0].querySelector('.typst-visual p')?.textContent).toBe('Beta');
  });

  it('keeps the chosen mode when switching documents', () => {
    const { views, a, b, visible, tab } = setup();
    views.show(a);
    tab('Source').click();
    expect(views.mode).toBe('source');
    views.show(b);
    expect(visible()[0].querySelector('[data-testid=typst-source]')?.textContent).toContain('Beta');
  });

  it('switches to the Source tab to reveal a range in the source view', () => {
    // regression: clicking the error count in the Visual view revealed the error in the hidden source view
    const { views, a, visible, tab } = setup();
    views.show(a);
    views.reveal(2, 3, 'source');
    expect(views.mode).toBe('source');
    expect(tab('Source').getAttribute('aria-selected')).toBe('true');
    expect(visible()).toHaveLength(1);
    expect(visible()[0].querySelector('[data-testid=typst-source]')).not.toBeNull();
  });

  it('puts the actions at the end of the tab bar and tells when the user switches tabs', () => {
    const parent = document.createElement('div');
    document.body.append(parent);
    const modes: string[] = [];
    const views = new EditingViews(parent, { visualView: VisualViewContributions.from([]), onMode: (mode) => modes.push(mode) });
    views.show(new TypstDocument('Alpha\n'));
    const actions = document.createElement('div');
    views.addTabActions(actions);
    expect(parent.querySelector('.typst-editor__tabs')?.lastElementChild).toBe(actions);
    const tab = (name: string) => [...parent.querySelectorAll<HTMLElement>('[role=tab]')].find((t) => t.textContent === name)!;
    tab('Source').click();
    tab('Source').click();
    tab('Visual').click();
    expect(modes).toEqual(['source', 'visual']);
  });

  it('reveals in the current view without switching tabs otherwise', () => {
    const { views, a, visible } = setup();
    views.show(a);
    views.reveal(2, 3);
    expect(views.mode).toBe('visual');
    expect(visible()[0].querySelector('[data-testid=typst-source]')).toBeNull();
  });

  it('hides everything, tabs included, when no document is shown', () => {
    const { parent, views, a, visible } = setup();
    views.show(a);
    views.show(null);
    expect(visible()).toHaveLength(0);
    expect(parent.querySelector<HTMLElement>('.typst-editor__tabs')!.hidden).toBe(true);
  });

  it('disposes the views of documents that are gone', () => {
    const { parent, views, a, b } = setup('source');
    views.show(a);
    views.show(b);
    views.retain([b]);
    expect(parent.querySelectorAll('.typst-editor__pane')).toHaveLength(2);
    expect(parent.textContent).not.toContain('Alpha');
  });
});

describe('EditingViews selection reports', () => {
  it('reports a moved selection after the view has it (the collaboration cursor is never one step behind)', () => {
    const parent = document.createElement('div');
    document.body.append(parent);
    const seen: { from: number; to: number }[] = [];
    const views = new EditingViews(parent, { onSelection: (editor) => seen.push(editor.selection) });
    views.show(new TypstDocument('Hello world\n'));
    views.activeTextEditor!.revealRange(6, 11);
    expect(seen.at(-1)).toEqual({ from: 6, to: 11 });
    views.reveal(0, 5, 'source');
    expect(seen.at(-1)).toEqual({ from: 0, to: 5 });
  });
});

describe('EditingViews frame', () => {
  it('puts the frame elements first and last in the visible pane, following tab and document switches', () => {
    const { parent, views, a, b, visible, tab } = setup();
    const top = document.createElement('nav');
    const bottom = document.createElement('nav');
    views.setFrame({ top, bottom });
    views.show(a);
    const pane = () => visible()[0];
    // Visual: below the toolbar, right before the text; last in the pane
    expect(top.previousElementSibling?.getAttribute('role')).toBe('toolbar');
    expect(top.nextElementSibling?.className).toBe('typst-visual__body');
    expect(pane().lastElementChild).toBe(bottom);
    tab('Source').click();
    expect(pane().querySelector('.cm-editor')).not.toBeNull();
    expect([pane().firstElementChild, pane().lastElementChild]).toEqual([top, bottom]);
    views.show(b);
    expect(pane().contains(top)).toBe(true);
    views.show(null);
    expect([top.isConnected, bottom.isConnected]).toEqual([false, false]);
    expect(parent.querySelectorAll('nav')).toHaveLength(0);
  });

  it('removes the frame on null', () => {
    const { views, a } = setup();
    const top = document.createElement('nav');
    const bottom = document.createElement('nav');
    views.setFrame({ top, bottom });
    views.show(a);
    views.setFrame(null);
    expect([top.isConnected, bottom.isConnected]).toEqual([false, false]);
  });
});
