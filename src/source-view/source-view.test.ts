// @vitest-environment jsdom
import '../visual-view/jsdom-setup';
import { describe, expect, it, vi } from 'vitest';
import { TypstDocument } from '../document/typst-document';
import { SourceView } from './source-view';

function setup(text: string, onBaseChange = vi.fn()) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const doc = new TypstDocument(text);
  const view = new SourceView(parent, doc, { onBaseChange });
  return { doc, view, parent, onBaseChange };
}

/** Lines marked as changed. (jsdom's selector cache misses class changes CodeMirror makes in place.) */
function changedLines(parent: HTMLElement): number {
  return [...parent.querySelectorAll('.cm-line')].filter((line) => line.classList.contains('cm-changedLine')).length;
}

describe('SourceView changes', () => {
  it('shows a unified diff against the base and removes it again', () => {
    const { view, parent } = setup('Hello big world\n');
    view.showChanges('Hello world\n');
    expect(changedLines(parent)).toBeGreaterThan(0);
    expect(parent.querySelector('.cm-deletedChunk')?.textContent).toContain('Hello world');
    view.showChanges(null);
    expect(changedLines(parent)).toBe(0);
  });

  it('rejecting a chunk restores the base text in the document', () => {
    const { doc, view, parent } = setup('Hello big world\n');
    view.showChanges('Hello world\n');
    parent.querySelector<HTMLButtonElement>('button[name=reject]')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(doc.text).toBe('Hello world\n');
  });

  it('accepting a chunk reports the new base', () => {
    const { doc, view, parent, onBaseChange } = setup('Hello big world\n');
    view.showChanges('Hello world\n');
    parent.querySelector<HTMLButtonElement>('button[name=accept]')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(onBaseChange).toHaveBeenCalledWith('Hello big world\n');
    expect(doc.text).toBe('Hello big world\n');
  });

  it('follows document changes while showing changes', () => {
    const { doc, view, parent } = setup('Hello world\n');
    view.showChanges('Hello world\n');
    expect(changedLines(parent)).toBe(0);
    doc.setText('Hello there world\n', 'visual');
    expect(changedLines(parent)).toBeGreaterThan(0);
  });
});

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
