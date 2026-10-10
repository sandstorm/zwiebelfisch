// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { TypstDocument } from '../document/typst-document';
import { EditingViews } from './editing-views';

// jsdom lacks layout; ProseMirror and CodeMirror only need these to exist.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();
Element.prototype.scrollIntoView = () => {};

function setup(mode?: 'visual' | 'source') {
  const parent = document.createElement('div');
  document.body.append(parent);
  const views = new EditingViews(parent, { mode });
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
