// @vitest-environment jsdom
// Tests for editing-views.ts.
import { describe, expect, it } from 'vitest';
import { TypstDocument } from '../../../core/typst-document/typst-document';
import { headings, markup, VisualViewContributions } from '../../visual-view/visual-view';
import { EditingViews } from './editing-views';

// jsdom lacks layout; ProseMirror and CodeMirror only need these to exist.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();
Element.prototype.scrollIntoView = () => {};

function setup(mode?: 'visual' | 'source') {
  const parent = document.createElement('div');
  document.body.append(parent);
  const views = new EditingViews(parent, { mode, visualView: VisualViewContributions.from([markup, headings]) });
  const a = new TypstDocument('= A\n');
  const b = new TypstDocument('= B\n');
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
    expect(parent.querySelector('h1')?.textContent).toBe('A');
  });

  it('creates the views of a document only when it is first shown', () => {
    const { parent, views, a, b, visible } = setup();
    views.show(a);
    expect(parent.querySelectorAll('.typst-editor__pane')).toHaveLength(2);
    views.show(b);
    expect(parent.querySelectorAll('.typst-editor__pane')).toHaveLength(4);
    expect(visible()).toHaveLength(1);
    expect(visible()[0].querySelector('h1')?.textContent).toBe('B');
  });

  it('keeps the chosen mode when switching documents', () => {
    const { views, a, b, visible, tab } = setup();
    views.show(a);
    tab('Source').click();
    expect(views.mode).toBe('source');
    views.show(b);
    expect(visible()[0].querySelector('[data-testid=typst-source]')?.textContent).toContain('= B');
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

  it('shows a tab-bar control for one view only in that view (the Source view\'s "Comment")', () => {
    const { parent, views, a, tab } = setup();
    views.show(a);
    const comment = document.createElement('button');
    const always = document.createElement('span');
    views.addTabAction(comment, 'source');
    views.addTabAction(always);
    expect([comment.hidden, always.hidden]).toEqual([true, false]);
    tab('Source').click();
    expect([comment.hidden, always.hidden]).toEqual([false, false]);
    expect(parent.querySelector('.typst-editor__tabs')?.contains(comment)).toBe(true);
  });

  it('removes a tab-bar control', () => {
    const { parent, views, a } = setup();
    views.show(a);
    const comment = document.createElement('button');
    const remove = views.addTabAction(comment, 'source');
    remove();
    expect(parent.querySelector('.typst-editor__tabs')?.contains(comment)).toBe(false);
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

  it('destroys the views of documents that are gone', () => {
    const { parent, views, a, b } = setup('source');
    views.show(a);
    views.show(b);
    views.retain([b]);
    expect(parent.querySelectorAll('.typst-editor__pane')).toHaveLength(2);
    expect(parent.textContent).not.toContain('= A');
  });
});

describe('EditingViews diagnostics', () => {
  const error = { severity: 'error' as const, message: 'unknown variable: foo', hints: ['did you mean bar?'], from: 0, to: 0 };

  it('marks diagnostics inline in the Visual view, message and hints as tooltip', () => {
    const { parent, views } = setup();
    const doc = new TypstDocument('Hello world.\n');
    views.show(doc);
    views.setDiagnostics(doc, [{ ...error, from: 6, to: 11 }]);
    const mark = parent.querySelector<HTMLElement>('.ProseMirror .typst-diagnostic')!;
    expect(mark.textContent).toBe('world');
    expect(mark.dataset.severity).toBe('error');
    expect(mark.title).toBe('unknown variable: foo\nhint: did you mean bar?');
  });

  it('marks block atoms (raw code) the diagnostic falls into', () => {
    const { parent, views } = setup();
    const doc = new TypstDocument('#foo\n\nText.\n');
    views.show(doc);
    views.setDiagnostics(doc, [{ ...error, from: 1, to: 4 }]);
    expect(parent.querySelector('.ProseMirror .typst-diagnostic')).not.toBeNull();
  });

  it('applies diagnostics set before the views exist', () => {
    const { parent, views } = setup();
    const doc = new TypstDocument('Hello world.\n');
    views.setDiagnostics(doc, [{ ...error, from: 0, to: 5 }]);
    views.show(doc);
    expect(parent.querySelector('.ProseMirror .typst-diagnostic')?.textContent).toBe('Hello');
  });
});

describe('EditingViews selection reports', () => {
  it('reports a moved selection after the view has it (the collaboration cursor is never one step behind)', () => {
    const parent = document.createElement('div');
    document.body.append(parent);
    const seen: { from: number; to: number }[] = [];
    const doc = new TypstDocument('Hello world\n');
    const views = new EditingViews(parent, { onSelection: (editor) => seen.push(views.viewsOf(editor.document).visual.selection()) });
    views.show(doc);
    const { visual, source } = views.viewsOf(doc);
    visual.reveal(6, 11);
    expect(seen.at(-1)).toEqual({ from: 6, to: 11 });
    const before = seen.length;
    source.reveal(0, 5);
    expect(seen.length).toBeGreaterThan(before);
  });
});

describe('EditingViews cursor reports (the preview follows them)', () => {
  it('reports the cursor of the focused Visual view, not of an unfocused one', () => {
    const parent = document.createElement('div');
    document.body.append(parent);
    const cursors: number[] = [];
    const doc = new TypstDocument('Hello world\n');
    const views = new EditingViews(parent, { onCursor: (_document, offset) => cursors.push(offset) });
    views.show(doc);
    const { visual } = views.viewsOf(doc);
    visual.reveal(6, 6);
    expect(cursors).toEqual([]);
    (parent.querySelector('.ProseMirror') as HTMLElement).focus();
    visual.reveal(6, 11);
    expect(cursors.at(-1)).toBe(6);
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
