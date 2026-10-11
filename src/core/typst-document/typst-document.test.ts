// Tests for typst-document.ts.
import { describe, expect, it, vi } from 'vitest';
import { SourceOffset, SourceRange, TypstDocument } from './typst-document';

describe('TypstDocument', () => {
  it('applies changes given in coordinates of the current text', () => {
    const doc = new TypstDocument('Hello world');
    doc.change([
      { from: SourceOffset.of(0), to: SourceOffset.of(5), insert: 'Goodbye' },
      { from: SourceOffset.of(11), to: SourceOffset.of(11), insert: '!' },
    ], 'test');
    expect(doc.text).toBe('Goodbye world!');
  });

  it('notifies listeners with the changes and their origin', () => {
    const doc = new TypstDocument('abc');
    const listener = vi.fn();
    doc.onDidChange(listener);
    const changes = [{ ...SourceRange.of({ from: 1, to: 2 }), insert: 'X' }];
    doc.change(changes, 'source-view');
    expect(listener).toHaveBeenCalledWith({ contentChanges: changes, origin: 'source-view' });
  });

  it('stops notifying after unsubscribing', () => {
    const doc = new TypstDocument('abc');
    const listener = vi.fn();
    doc.onDidChange(listener).dispose();
    doc.change([{ from: SourceOffset.of(0), to: SourceOffset.of(0), insert: 'x' }], 'test');
    expect(listener).not.toHaveBeenCalled();
  });

  it('tells every listener the changes in the order they were made, also one made by a listener', () => {
    const doc = new TypstDocument('abc');
    const heard: string[] = [];
    doc.onDidChange(({ origin }) => {
      if (origin === 'first') doc.change([{ from: SourceOffset.of(0), to: SourceOffset.of(0), insert: '>' }], 'nested');
    });
    doc.onDidChange(({ contentChanges, origin }) => heard.push(`${origin} ${contentChanges[0].insert}`));
    doc.change([{ from: SourceOffset.of(3), to: SourceOffset.of(3), insert: '!' }], 'first');
    expect(heard).toEqual(['first !', 'nested >']);
    expect(doc.text).toBe('>abc!');
  });

  it('ignores empty change lists', () => {
    const doc = new TypstDocument('abc');
    const listener = vi.fn();
    doc.onDidChange(listener);
    doc.change([{ from: SourceOffset.of(1), to: SourceOffset.of(1), insert: '' }], 'test');
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('TypstDocument.setText', () => {
  it('applies a whole new text as one minimal change', () => {
    const doc = new TypstDocument('Hello brave world');
    const listener = vi.fn();
    doc.onDidChange(listener);
    doc.setText('Hello new world', 'visual');
    expect(doc.text).toBe('Hello new world');
    expect(listener).toHaveBeenCalledWith({ contentChanges: [{ from: 6, to: 11, insert: 'new' }], origin: 'visual' });
  });

  it('does nothing when the text is unchanged', () => {
    const doc = new TypstDocument('same');
    const listener = vi.fn();
    doc.onDidChange(listener);
    doc.setText('same', 'visual');
    expect(listener).not.toHaveBeenCalled();
  });
});
