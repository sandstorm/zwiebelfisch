// Tests for text-binding.ts.
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { SourceOffset, SourceRange, type TextChange, TypstDocument } from '../../../core/typst-document/typst-document';
import { REMOTE_ORIGIN } from '../remote-origin';
import { TextBinding } from './text-binding';

/** `changes` (pre-change coordinates) applied to `text`, the way a view applies them. */
function applyChanges(text: string, changes: readonly TextChange[]): string {
  const doc = new TypstDocument(text);
  doc.change(changes, 'test');
  return doc.text;
}

/** A document bound to `text`. */
function bound(text: Y.Text, initial = ''): TypstDocument {
  const document = new TypstDocument(initial);
  new TextBinding(text, document);
  return document;
}

describe('TextBinding', () => {
  /** Two replicas that exchange every update in-process, like through a server. */
  function pair(initial = '') {
    const ya = new Y.Doc();
    const yb = new Y.Doc();
    ya.on('update', (update: Uint8Array, origin: unknown) => origin !== yb && Y.applyUpdate(yb, update, ya));
    yb.on('update', (update: Uint8Array, origin: unknown) => origin !== ya && Y.applyUpdate(ya, update, yb));
    ya.getText('t').insert(0, initial);
    return { a: bound(ya.getText('t')), b: bound(yb.getText('t')), ya };
  }

  it('the document starts with the shared text', () => {
    const { b } = pair('Hello');
    expect(b.text).toBe('Hello');
  });

  it('writes local changes into the Y.Text, in one transaction; listeners hear them once, with the local origin', () => {
    const { a, ya } = pair('Hello world');
    const listener = vi.fn();
    a.onDidChange(listener);
    const transactions = vi.fn();
    ya.on('afterTransaction', transactions);
    const changes = [{ ...SourceRange.of({ from: 0, to: 5 }), insert: 'Bye' }, { ...SourceRange.of({ from: 11, to: 11 }), insert: '!' }];
    a.change(changes, 'visual');
    expect(ya.getText('t').toString()).toBe('Bye world!');
    expect(transactions).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ contentChanges: changes, origin: 'visual' });
  });

  it('reports remote edits as changes with REMOTE_ORIGIN', () => {
    const { a, b } = pair('Hello world');
    const before = b.text;
    const listener = vi.fn();
    b.onDidChange(listener);
    a.change([{ from: SourceOffset.of(0), to: SourceOffset.of(5), insert: 'Bye' }, { from: SourceOffset.of(11), to: SourceOffset.of(11), insert: '!' }], 'visual');
    expect(b.text).toBe('Bye world!');
    expect(listener).toHaveBeenCalledTimes(1);
    const [{ contentChanges, origin }] = listener.mock.calls[0];
    expect(origin).toBe(REMOTE_ORIGIN);
    expect(applyChanges(before, contentChanges)).toBe('Bye world!');
  });

  it('converges under concurrent edits', () => {
    const ya = new Y.Doc();
    const yb = new Y.Doc();
    ya.getText('t').insert(0, 'one two three');
    Y.applyUpdate(yb, Y.encodeStateAsUpdate(ya));
    const a = bound(ya.getText('t'));
    const b = bound(yb.getText('t'));
    a.change([{ from: SourceOffset.of(0), to: SourceOffset.of(3), insert: 'ONE' }], 'a');
    b.change([{ from: SourceOffset.of(8), to: SourceOffset.of(13), insert: 'THREE' }], 'b');
    Y.applyUpdate(yb, Y.encodeStateAsUpdate(ya));
    Y.applyUpdate(ya, Y.encodeStateAsUpdate(yb));
    expect(a.text).toBe('ONE two THREE');
    expect(b.text).toBe(a.text);
  });

  it('a document adopts the text of the Y.Text it is bound to, as one minimal remote change', () => {
    const doc = new TypstDocument('local text');
    const ydoc = new Y.Doc();
    ydoc.getText('t').insert(0, 'shared text');
    const listener = vi.fn();
    doc.onDidChange(listener);
    new TextBinding(ydoc.getText('t'), doc);
    expect(doc.text).toBe('shared text');
    expect(listener).toHaveBeenCalledWith({ contentChanges: [{ from: 0, to: 5, insert: 'shared' }], origin: REMOTE_ORIGIN });
    doc.change([{ from: SourceOffset.of(0), to: SourceOffset.of(0), insert: '> ' }], 'test');
    expect(ydoc.getText('t').toString()).toBe('> shared text');
  });

  it('dispose() unbinds: the document keeps its text, and neither follows the other', () => {
    const ydoc = new Y.Doc();
    ydoc.getText('t').insert(0, 'abc');
    const doc = new TypstDocument('');
    new TextBinding(ydoc.getText('t'), doc).dispose();
    ydoc.getText('t').insert(0, 'x');
    doc.change([{ from: SourceOffset.of(3), to: SourceOffset.of(3), insert: 'd' }], 'test');
    expect(doc.text).toBe('abcd');
    expect(ydoc.getText('t').toString()).toBe('xabc');
  });

  it('keeps the Y.Text in step when a listener changes the document while it is told about a change', () => {
    const ydoc = new Y.Doc();
    const doc = new TypstDocument('abc');
    // a listener that runs before the binding and answers a change with one of its own
    doc.onDidChange(({ origin }) => {
      if (origin === 'typing') doc.change([{ from: SourceOffset.of(0), to: SourceOffset.of(0), insert: '>' }], 'normalise');
    });
    ydoc.getText('t').insert(0, 'abc');
    new TextBinding(ydoc.getText('t'), doc);
    doc.change([{ from: SourceOffset.of(3), to: SourceOffset.of(3), insert: '!' }], 'typing');
    expect(doc.text).toBe('>abc!');
    expect(ydoc.getText('t').toString()).toBe('>abc!');
  });

  it('refuses a Y.Text that is not part of a Y.Doc', () => {
    expect(() => new TextBinding(new Y.Text(), new TypstDocument(''))).toThrow(/Y.Doc/);
  });
});
