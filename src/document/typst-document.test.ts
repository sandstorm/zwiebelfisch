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
