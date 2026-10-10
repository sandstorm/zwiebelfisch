// @vitest-environment jsdom
// Tests for source-view.ts.
import { describe, expect, it } from 'vitest';
import { undo } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import { REMOTE_ORIGIN, TypstDocument } from '../../core/typst-document/typst-document';
import { SourceView } from './source-view';

function setup(text: string) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const doc = new TypstDocument(text);
  const view = new SourceView(parent, doc);
  return { doc, view, parent };
}

describe('SourceView history', () => {
  it('undo reverts only local edits, not those of collaborators', () => {
    const { doc, parent } = setup('one two\n');
    const editor = EditorView.findFromDOM(parent.querySelector<HTMLElement>('.cm-editor')!)!;
    editor.dispatch({ changes: { from: 0, to: 3, insert: 'ONE' }, userEvent: 'input.type' });
    doc.change([{ from: 4, to: 7, insert: 'TWO' }], REMOTE_ORIGIN);
    undo(editor);
    expect(doc.text).toBe('one TWO\n');
  });
});

const marked = (parent: HTMLElement, selector: string) =>
  [...parent.querySelectorAll(selector)].map((element) => element.textContent);

describe('SourceView highlights', () => {
  it('marks highlighted ranges with class and attributes, per layer', () => {
    const { view, parent } = setup('Some bold text\n');
    view.setHighlights('cursors', [{ from: 5, to: 9, className: 'note', attributes: { 'data-user': 'a' } }]);
    view.setHighlights('search', [{ from: 10, to: 14, className: 'match' }]);
    expect(marked(parent, '.note[data-user="a"]')).toEqual(['bold']);
    expect(marked(parent, '.match')).toEqual(['text']);
    view.setHighlights('cursors', []);
    expect(marked(parent, '.note')).toEqual([]);
    expect(marked(parent, '.match')).toEqual(['text']);
  });

  it('keeps highlights on their text through edits from elsewhere', () => {
    const { doc, view, parent } = setup('Some bold text\n');
    view.setHighlights('cursors', [{ from: 5, to: 9, className: 'note' }]);
    doc.change([{ from: 0, to: 0, insert: 'Really. ' }], 'visual');
    expect(marked(parent, '.note')).toEqual(['bold']);
  });

  it('reports the selection as a source range', () => {
    const { view } = setup('Some bold text\n');
    view.reveal(5, 9);
    expect(view.selection()).toEqual({ from: 5, to: 9 });
  });
});

describe('SourceView presence', () => {
  const ann = { id: '1', user: { name: 'Ann', color: '#b58900' } };
  /** The line text before each caret. */
  const carets = (parent: HTMLElement) =>
    [...parent.querySelectorAll<HTMLElement>('.cm-line .typst-remote-caret')].map((caret) => {
      const nodes = [...caret.closest('.cm-line')!.childNodes];
      return nodes.slice(0, nodes.indexOf(caret)).map((node) => node.textContent).join('');
    });

  it('draws a named caret at the position, also on an empty line', () => {
    const { view, parent } = setup('one\n\nthree\n');
    view.setPresence([{ ...ann, anchor: 4, head: 4 }]);
    const caret = parent.querySelector<HTMLElement>('.typst-remote-caret')!;
    expect(caret.dataset.user).toBe('Ann');
    expect(caret.closest('.cm-line')!.textContent).toBe('Ann');
    expect(caret.querySelector('.typst-remote-caret__flag')!.textContent).toBe('Ann');
    expect(caret.style.getPropertyValue('--typst-remote-color')).toBe('#b58900');
    view.setPresence([{ ...ann, anchor: 2, head: 2 }]);
    expect(carets(parent)).toEqual(['on']);
  });

  it('tints the selection and keeps it on its text through edits', () => {
    const { doc, view, parent } = setup('Some bold text\n');
    view.setPresence([{ ...ann, anchor: 5, head: 9 }]);
    expect(marked(parent, '.typst-remote-selection[data-user="Ann"]')).toEqual(['bold']);
    doc.change([{ from: 0, to: 0, insert: 'Really. ' }], 'visual');
    expect(marked(parent, '.typst-remote-selection')).toEqual(['bold']);
    expect(carets(parent)).toEqual(['Really. Some bold']);
    view.setPresence([]);
    expect(parent.querySelector('.typst-remote-caret, .typst-remote-selection')).toBeNull();
  });

  it('redraws the caret (showing the name again) only when it moved', () => {
    const { view, parent } = setup('Some bold text\n');
    view.setPresence([{ ...ann, anchor: 2, head: 2 }]);
    const first = parent.querySelector('.typst-remote-caret');
    expect(first!.classList).toContain('typst-remote-caret--transient');
    view.setPresence([{ ...ann, anchor: 2, head: 2 }]);
    expect(parent.querySelector('.typst-remote-caret')).toBe(first);
    view.setPresence([{ ...ann, anchor: 3, head: 3 }]);
    expect(parent.querySelector('.typst-remote-caret')).not.toBe(first);
  });
});
