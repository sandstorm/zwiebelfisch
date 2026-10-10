// @vitest-environment jsdom
import '../visual-view/jsdom-setup';
import { describe, expect, it } from 'vitest';
import { TypstDocument } from '../document/typst-document';
import { SourceView } from './source-view';

function setup(text: string) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const doc = new TypstDocument(text);
  const view = new SourceView(parent, doc);
  return { doc, view, parent };
}

const marked = (parent: HTMLElement, selector: string) =>
  [...parent.querySelectorAll(selector)].map((element) => element.textContent);

describe('SourceView highlights', () => {
  it('marks highlighted ranges with class and attributes, per layer', () => {
    const { view, parent } = setup('Some bold text\n');
    view.setHighlights('comments', [{ from: 5, to: 9, className: 'note', attributes: { 'data-comment-id': 'a' } }]);
    view.setHighlights('diff', [{ from: 10, to: 14, className: 'added' }]);
    expect(marked(parent, '.note[data-comment-id="a"]')).toEqual(['bold']);
    expect(marked(parent, '.added')).toEqual(['text']);
    view.setHighlights('comments', []);
    expect(marked(parent, '.note')).toEqual([]);
    expect(marked(parent, '.added')).toEqual(['text']);
  });

  it('keeps highlights on their text through edits from elsewhere', () => {
    const { doc, view, parent } = setup('Some bold text\n');
    view.setHighlights('comments', [{ from: 5, to: 9, className: 'note' }]);
    doc.change([{ from: 0, to: 0, insert: 'Really. ' }], 'visual');
    expect(marked(parent, '.note')).toEqual(['bold']);
  });

  it('reports the selection as a source range', () => {
    const { view } = setup('Some bold text\n');
    view.reveal(5, 9);
    expect(view.selection()).toEqual({ from: 5, to: 9 });
  });
});
