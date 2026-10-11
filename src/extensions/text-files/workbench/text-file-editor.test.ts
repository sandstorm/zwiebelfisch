// @vitest-environment jsdom
// Tests for text-file-editor.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { undo } from '@codemirror/commands';
import { ProjectPath } from '../../../core/paths/paths';
import { SAVE_DELAY, TextFileEditor } from './text-file-editor';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

function setup(text = '@book{a}\n') {
  const parent = document.body.appendChild(document.createElement('div'));
  const save = vi.fn<(text: string) => void>();
  const editor = new TextFileEditor(parent, { path: ProjectPath.of('/refs.bib'), text, save });
  // CodeMirror's own view of the editor, standing in for the user's typing
  const view = EditorView.findFromDOM(parent.querySelector<HTMLElement>('.cm-editor')!)!;
  const type = (insert: string, at = view.state.doc.length) => view.dispatch({ changes: { from: at, insert }, selection: { anchor: at + insert.length }, userEvent: 'input.type' });
  return { parent, editor, view, save, type };
}

describe('TextFileEditor', () => {
  it('shows the file with its name', () => {
    const { parent, view } = setup();
    expect(parent.querySelector('[data-testid=typst-text-file] h2')?.textContent).toBe('refs.bib');
    expect(view.state.doc.toString()).toBe('@book{a}\n');
  });

  it('saves the whole text a while after the last edit', () => {
    const { save, type } = setup();
    type('@book{b}');
    vi.advanceTimersByTime(SAVE_DELAY - 1);
    type('\n');
    vi.advanceTimersByTime(SAVE_DELAY - 1);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledExactlyOnceWith('@book{a}\n@book{b}\n');
  });

  it('saves what is pending when disposed, and takes its element away', () => {
    const { parent, editor, save, type } = setup();
    type('x');
    editor.dispose();
    expect(save).toHaveBeenCalledExactlyOnceWith('@book{a}\nx');
    expect(parent.querySelector('[data-testid=typst-text-file]')).toBeNull();
    vi.advanceTimersByTime(SAVE_DELAY);
    expect(save).toHaveBeenCalledOnce();
  });

  it('a change from elsewhere shows up in place: the cursor stays, nothing is saved, undo keeps to own edits', () => {
    const { editor, view, save, type } = setup('one\nthree\n');
    type('!', 3);
    vi.advanceTimersByTime(SAVE_DELAY);
    save.mockClear();
    editor.reload('one!\ntwo\nthree\n');
    expect(view.state.doc.toString()).toBe('one!\ntwo\nthree\n');
    expect(view.state.selection.main.head).toBe(4);
    vi.advanceTimersByTime(SAVE_DELAY);
    expect(save).not.toHaveBeenCalled();
    undo(view);
    expect(view.state.doc.toString()).toBe('one\ntwo\nthree\n');
  });

  it('ignores changes from elsewhere while an own edit waits to be saved: that save replaces the file (last save wins)', () => {
    const { editor, view, save, type } = setup('a');
    type('b');
    editor.reload('their text');
    expect(view.state.doc.toString()).toBe('ab');
    vi.advanceTimersByTime(SAVE_DELAY);
    expect(save).toHaveBeenCalledExactlyOnceWith('ab');
    // its own save coming back changes nothing
    editor.reload('ab');
    expect(view.state.doc.toString()).toBe('ab');
  });
});
