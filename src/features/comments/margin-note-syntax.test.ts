// Tests for margin-note-syntax.ts.
import { describe, expect, it } from 'vitest';
import { isNoteCallAt, parseNoteCall, printNoteCall, safeNote } from './margin-note-syntax';

describe('parseNoteCall / printNoteCall', () => {
  it('splits point and range notes into head, text and note', () => {
    expect(parseNoteCall('#margin-note[a *note*]')).toEqual({ head: '#margin-note', note: 'a *note*' });
    expect(parseNoteCall('#margin-note(side: left, dy: 1em)[key][see [this]]')).toEqual({
      head: '#margin-note(side: left, dy: 1em)',
      text: 'key',
      note: 'see [this]',
    });
    expect(parseNoteCall('#margin-note[]')).toEqual({ head: '#margin-note', note: '' });
  });

  it('prints the parts back as they were', () => {
    for (const src of ['#margin-note[a]', '#margin-note(side: left)[x][y]', '#margin-note[one\n\ntwo]']) {
      expect(printNoteCall(parseNoteCall(src)!)).toBe(src);
    }
  });

  it('rejects other calls and forms', () => {
    for (const src of [
      '#margin-note([a], [b])',
      '#margin-note(side: left, [x])',
      '#margin-note[][]',
      '#margin-note[a\n\nb][c]',
      '#margin-note[a][b][c]',
      '#margin-note[a *b]',
      '#margin-note[a',
      '#inline-note[a]',
      '#margin-note[a] more',
      'x #margin-note[a]',
    ]) {
      expect(parseNoteCall(src), src).toBeNull();
    }
  });
});

describe('isNoteCallAt', () => {
  it('accepts a note call in markup ending exactly at `to`', () => {
    const text = 'A #margin-note[b][c] d';
    expect(isNoteCallAt(text, 2, 20)).toBe(true);
    expect(isNoteCallAt(text, 2, 19)).toBe(false);
    expect(isNoteCallAt('#set text(size: #margin-note[x])', 16, 31)).toBe(false);
  });
});

describe('safeNote', () => {
  const kept = (note: string) => {
    const safe = safeNote(note);
    expect(parseNoteCall(`#margin-note[${safe}]`)?.note, note).toBe(safe);
    return safe;
  };

  it('keeps well-formed markup as it is', () => {
    expect(kept('a [b] *c* $x$ `y`')).toBe('a [b] *c* $x$ `y`');
    expect(kept('one\n\ntwo')).toBe('one\n\ntwo');
  });

  it('escapes brackets without a partner', () => {
    expect(kept('a ] b [ c')).toBe('a \\] b \\[ c');
    expect(kept('x \\] y')).toBe('x \\] y');
  });

  it('escapes markup that would break out of the call as plain text', () => {
    expect(kept('ends with \\')).toBe('ends with \\\\');
    expect(kept('a // b')).toBe('a \\// b');
    expect(kept('c /* x')).toBe('c \\/\\* x');
    expect(kept('tick `code')).toBe('tick \\`code');
    expect(kept('dollar $x')).toBe('dollar \\$x');
  });
});
