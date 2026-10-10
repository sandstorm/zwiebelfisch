import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { REMOTE_ORIGIN, TypstDocument, type TextChange } from './typst-document';

describe('TypstDocument', () => {
  it('applies changes given in coordinates of the current text', () => {
    const doc = new TypstDocument('Hello world');
    doc.change([
      { from: 0, to: 5, insert: 'Goodbye' },
      { from: 11, to: 11, insert: '!' },
    ], 'test');
    expect(doc.text).toBe('Goodbye world!');
  });

  it('notifies listeners with the changes and their origin', () => {
    const doc = new TypstDocument('abc');
    const listener = vi.fn();
    doc.onChange(listener);
    const changes = [{ from: 1, to: 2, insert: 'X' }];
    doc.change(changes, 'source-view');
    expect(listener).toHaveBeenCalledWith(changes, 'source-view');
  });

  it('stops notifying after unsubscribing', () => {
    const doc = new TypstDocument('abc');
    const listener = vi.fn();
    doc.onChange(listener)();
    doc.change([{ from: 0, to: 0, insert: 'x' }], 'test');
    expect(listener).not.toHaveBeenCalled();
  });

  it('ignores empty change lists', () => {
    const doc = new TypstDocument('abc');
    const listener = vi.fn();
    doc.onChange(listener);
    doc.change([{ from: 1, to: 1, insert: '' }], 'test');
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('TypstDocument.setText', () => {
  it('applies a whole new text as one minimal change', () => {
    const doc = new TypstDocument('Hello brave world');
    const listener = vi.fn();
    doc.onChange(listener);
    doc.setText('Hello new world', 'visual');
    expect(doc.text).toBe('Hello new world');
    expect(listener).toHaveBeenCalledWith([{ from: 6, to: 11, insert: 'new' }], 'visual');
  });

  it('does nothing when the text is unchanged', () => {
    const doc = new TypstDocument('same');
    const listener = vi.fn();
    doc.onChange(listener);
    doc.setText('same', 'visual');
    expect(listener).not.toHaveBeenCalled();
  });
});

/** `changes` (pre-change coordinates) applied to `text`, the way a view applies them. */
function applyChanges(text: string, changes: readonly TextChange[]): string {
  const doc = new TypstDocument(text);
  doc.change(changes, 'test');
  return doc.text;
}

describe('TypstDocument shared through a Y.Text', () => {
  /** Two replicas that exchange every update in-process, like through a server. */
  function pair(initial = '') {
    const ya = new Y.Doc();
    const yb = new Y.Doc();
    ya.on('update', (update: Uint8Array, origin: unknown) => origin !== yb && Y.applyUpdate(yb, update, ya));
    yb.on('update', (update: Uint8Array, origin: unknown) => origin !== ya && Y.applyUpdate(ya, update, yb));
    ya.getText('t').insert(0, initial);
    return { a: TypstDocument.fromYText(ya.getText('t')), b: TypstDocument.fromYText(yb.getText('t')), ya };
  }

  it('starts with the shared text', () => {
    const { b } = pair('Hello');
    expect(b.text).toBe('Hello');
  });

  it('writes local changes into the Y.Text and notifies once with the local origin', () => {
    const { a, ya } = pair('Hello world');
    const listener = vi.fn();
    a.onChange(listener);
    const changes = [{ from: 0, to: 5, insert: 'Bye' }, { from: 11, to: 11, insert: '!' }];
    a.change(changes, 'visual');
    expect(ya.getText('t').toString()).toBe('Bye world!');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(changes, 'visual');
  });

  it('reports remote edits as changes with the remote origin', () => {
    const { a, b } = pair('Hello world');
    const before = b.text;
    const listener = vi.fn();
    b.onChange(listener);
    a.change([{ from: 0, to: 5, insert: 'Bye' }, { from: 11, to: 11, insert: '!' }], 'visual');
    expect(b.text).toBe('Bye world!');
    expect(listener).toHaveBeenCalledTimes(1);
    const [changes, origin] = listener.mock.calls[0];
    expect(origin).toBe(REMOTE_ORIGIN);
    expect(applyChanges(before, changes)).toBe('Bye world!');
  });

  it('converges under concurrent edits', () => {
    const ya = new Y.Doc();
    const yb = new Y.Doc();
    ya.getText('t').insert(0, 'one two three');
    Y.applyUpdate(yb, Y.encodeStateAsUpdate(ya));
    const a = TypstDocument.fromYText(ya.getText('t'));
    const b = TypstDocument.fromYText(yb.getText('t'));
    a.change([{ from: 0, to: 3, insert: 'ONE' }], 'a');
    b.change([{ from: 8, to: 13, insert: 'THREE' }], 'b');
    Y.applyUpdate(yb, Y.encodeStateAsUpdate(ya));
    Y.applyUpdate(ya, Y.encodeStateAsUpdate(yb));
    expect(a.text).toBe('ONE two THREE');
    expect(b.text).toBe(a.text);
  });

  it('share() switches to another Y.Text, adopting its text as one remote change', () => {
    const doc = new TypstDocument('local text');
    const ydoc = new Y.Doc();
    ydoc.getText('t').insert(0, 'shared text');
    const listener = vi.fn();
    doc.onChange(listener);
    doc.share(ydoc.getText('t'));
    expect(doc.text).toBe('shared text');
    expect(listener).toHaveBeenCalledWith([{ from: 0, to: 5, insert: 'shared' }], REMOTE_ORIGIN);
    doc.change([{ from: 0, to: 0, insert: '> ' }], 'test');
    expect(ydoc.getText('t').toString()).toBe('> shared text');
  });

  it('share(null) stops following the Y.Text and keeps the text', () => {
    const ydoc = new Y.Doc();
    ydoc.getText('t').insert(0, 'abc');
    const doc = TypstDocument.fromYText(ydoc.getText('t'));
    doc.share(null);
    ydoc.getText('t').insert(0, 'x');
    doc.change([{ from: 3, to: 3, insert: 'd' }], 'test');
    expect(doc.text).toBe('abcd');
    expect(ydoc.getText('t').toString()).toBe('xabc');
  });
});
