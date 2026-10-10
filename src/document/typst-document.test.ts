import { describe, expect, it, vi } from 'vitest';
import { TypstDocument } from './typst-document';

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
