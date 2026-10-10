import { describe, expect, it, vi } from 'vitest';
import { TypstDocument } from '../document/typst-document';
import { Comments } from './comments';

const TEXT = '= Title\n\nSome *bold* text and more text.\n';

function setup(text = TEXT, json?: string) {
  const document = new TypstDocument(text);
  let id = 0;
  const comments = new Comments(document, {
    json,
    user: { name: 'Ada' },
    now: () => new Date('2026-10-10T12:00:00Z'),
    id: () => `c${++id}`,
  });
  return { document, comments };
}

function rangeOf(text: string, needle: string, occurrence = 0) {
  let from = -1;
  for (let i = 0; i <= occurrence; i++) from = text.indexOf(needle, from + 1);
  return { from, to: from + needle.length };
}

function quoted(comments: Comments, document: TypstDocument) {
  return comments.threads().map((t) => (t.range ? document.text.slice(t.range.from, t.range.to) : null));
}

describe('Comments', () => {
  it('adds a thread with author and time', () => {
    const { comments } = setup();
    const id = comments.add(rangeOf(TEXT, 'bold'), 'Why bold?')!;
    expect(comments.threads()).toEqual([
      {
        id,
        range: rangeOf(TEXT, 'bold'),
        quote: 'bold',
        resolved: false,
        comments: [{ id: 'c2', author: 'Ada', time: '2026-10-10T12:00:00.000Z', text: 'Why bold?' }],
      },
    ]);
  });

  it('replies, resolves, reopens and removes', () => {
    const { comments } = setup();
    const id = comments.add(rangeOf(TEXT, 'bold'), 'Why bold?')!;
    comments.reply(id, 'Emphasis.');
    expect(comments.threads()[0].comments.map((c) => c.text)).toEqual(['Why bold?', 'Emphasis.']);
    comments.setResolved(id, true);
    expect(comments.threads()[0].resolved).toBe(true);
    comments.setResolved(id, false);
    expect(comments.threads()[0].resolved).toBe(false);
    comments.remove(id);
    expect(comments.threads()).toEqual([]);
  });

  it('lists threads in document order, orphans first', () => {
    const { comments, document } = setup();
    comments.add(rangeOf(TEXT, 'more'), 'second');
    comments.add(rangeOf(TEXT, 'Title'), 'first');
    comments.add(rangeOf(TEXT, 'Some'), 'gone');
    document.change([{ from: TEXT.indexOf('Some'), to: TEXT.indexOf('Some') + 5, insert: '' }], 'source');
    expect(comments.threads().map((t) => t.comments[0].text)).toEqual(['gone', 'first', 'second']);
    expect(comments.threads()[0].range).toBeNull();
  });

  it('moves anchors through edits from any origin and through setText', () => {
    const { comments, document } = setup();
    comments.add(rangeOf(TEXT, 'bold'), 'a');
    comments.add(rangeOf(TEXT, 'more text'), 'b');
    document.change([{ from: 0, to: 0, insert: '#set page(width: 10cm)\n' }], 'source-view');
    document.change([{ from: document.text.indexOf('bold') + 2, to: document.text.indexOf('bold') + 2, insert: 'LD' }], 'visual-view');
    document.setText(document.text.replace('and more', 'and also more'), 'api');
    expect(quoted(comments, document)).toEqual(['boLDld', 'more text']);
  });

  it('turns a thread whose text was deleted into an orphan and restores it on undo', () => {
    const { comments, document } = setup();
    comments.add(rangeOf(TEXT, 'bold'), 'a');
    const before = document.text;
    document.setText(TEXT.replace('Some *bold* text and ', ''), 'source');
    expect(comments.threads()[0].range).toBeNull();
    expect(comments.threads()[0].quote).toBe('bold');
    document.setText(before, 'source');
    expect(quoted(comments, document)).toEqual(['bold']);
  });

  it('notifies listeners about thread changes and moved anchors', () => {
    const { comments, document } = setup();
    const listener = vi.fn();
    comments.onChange(listener);
    const id = comments.add(rangeOf(TEXT, 'bold'), 'a')!;
    comments.reply(id, 'b');
    document.change([{ from: 0, to: 0, insert: 'x' }], 'source');
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('round-trips through JSON with quote selectors', () => {
    const { comments } = setup();
    const id = comments.add(rangeOf(TEXT, 'bold'), 'Why bold?')!;
    comments.setResolved(id, true);
    const json = comments.serialize();
    expect(JSON.parse(json)).toEqual({
      version: 1,
      threads: [
        {
          id,
          anchor: { start: 15, end: 19, exact: 'bold', prefix: '= Title\n\nSome *', suffix: '* text and more text.\n' },
          resolved: true,
          comments: [{ id: 'c2', author: 'Ada', time: '2026-10-10T12:00:00.000Z', text: 'Why bold?' }],
        },
      ],
    });
    expect(setup(TEXT, json).comments.threads()).toEqual(comments.threads());
  });

  it('re-anchors persisted comments after the file changed elsewhere', () => {
    const { comments } = setup();
    comments.add(rangeOf(TEXT, 'text', 1), 'the second "text"');
    comments.add(rangeOf(TEXT, 'Title'), 'renamed later');
    const json = comments.serialize();
    const pulled = `#import "x.typ": *\n= Heading\n\nSome *bold* text and more text.\n`;
    const reloaded = setup(pulled, json);
    expect(reloaded.comments.threads().map((t) => t.range)).toEqual([null, rangeOf(pulled, 'text', 1)]);
  });

  it('replaces all threads on load and keeps orphans as orphans', () => {
    const { comments } = setup();
    comments.add(rangeOf(TEXT, 'bold'), 'a');
    const json = comments.serialize();
    const other = setup('nothing in common\n');
    other.comments.load(json);
    expect(other.comments.threads()).toHaveLength(1);
    expect(other.comments.threads()[0].range).toBeNull();
    expect(JSON.parse(other.comments.serialize()).threads[0].anchor.exact).toBe('bold');
  });

  it('stops following the document after destroy', () => {
    const { comments, document } = setup();
    comments.add(rangeOf(TEXT, 'bold'), 'a');
    comments.destroy();
    document.change([{ from: 0, to: 0, insert: 'xx' }], 'source');
    expect(comments.threads()[0].range).toEqual(rangeOf(TEXT, 'bold'));
  });
});
