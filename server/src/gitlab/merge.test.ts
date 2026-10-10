import { describe, expect, it } from 'vitest';
import { applyEdits, merge3, mergeFiles, textEdits } from './merge.ts';

describe('merge3', () => {
  const base = 'one\ntwo\nthree\nfour\nfive\n';

  it('takes changes of both sides in different places', () => {
    const current = 'ONE\ntwo\nthree\nfour\nfive\n';
    const upstream = 'one\ntwo\nthree\nfour\nFIVE\n';
    expect(merge3(base, current, upstream)).toEqual({ merged: 'ONE\ntwo\nthree\nfour\nFIVE\n' });
  });

  it('is not a conflict when both sides made the same change', () => {
    const same = 'one\nTWO\nthree\nfour\nfive\n';
    expect(merge3(base, same, same)).toEqual({ merged: same });
  });

  it('reports the current text range of a conflicting hunk', () => {
    const current = 'one\ntwo\nmine\nfour\nfive\n';
    const upstream = 'one\ntwo\ntheirs\nfour\nfive\n';
    const result = merge3(base, current, upstream);
    expect(result).toEqual({ conflicts: [{ from: 8, to: 13 }] });
    if ('conflicts' in result) expect(current.slice(result.conflicts[0].from, result.conflicts[0].to)).toBe('mine\n');
  });

  it('handles texts without a final newline', () => {
    expect(merge3('a\nb\nc', 'A\nb\nc', 'a\nb\nC')).toEqual({ merged: 'A\nb\nC' });
  });

  it('treats changes to adjacent lines as a conflict (like diff3)', () => {
    expect(merge3('a\nb\n', 'A\nb\n', 'a\nB\n')).toEqual({ conflicts: [{ from: 0, to: 4 }] });
  });
});

describe('textEdits', () => {
  it('turns one text into the other with small edits', () => {
    const from = 'Hello world\nsecond line\nthird\n';
    const to = 'Hello there world\nsecond line\nthird line\n';
    const edits = textEdits(from, to);
    expect(applyEdits(from, edits)).toBe(to);
    expect(edits).toEqual([
      { from: 6, to: 6, insert: 'there ' },
      { from: 29, to: 29, insert: ' line' },
    ]);
  });

  it('round-trips insertions and deletions of whole lines', () => {
    const from = 'a\nb\nc\n';
    for (const to of ['', 'a\nc\n', 'x\na\nb\nc\ny', 'b\n']) expect(applyEdits(from, textEdits(from, to))).toBe(to);
  });
});

describe('mergeFiles', () => {
  it('takes upstream changes where the room did not change the file, and merges where both did', () => {
    const base = { '/a.typ': 'a\n', '/b.typ': 'b1\nb2\nb3\n', '/gone.typ': 'g' };
    const current = { '/a.typ': 'a\n', '/b.typ': 'B1\nb2\nb3\n', '/gone.typ': 'g', '/mine.typ': 'm' };
    const upstream = { '/a.typ': 'A\n', '/b.typ': 'b1\nb2\nB3\n', '/new.typ': 'n' };
    expect(mergeFiles(base, current, upstream)).toEqual({
      changes: { '/a.typ': 'A\n', '/b.typ': 'B1\nb2\nB3\n', '/gone.typ': null, '/new.typ': 'n' },
      conflicts: [],
    });
  });

  it('reports a file changed on one side and deleted on the other', () => {
    const result = mergeFiles({ '/a.typ': 'a' }, { '/a.typ': 'changed' }, {});
    expect(result.conflicts).toEqual([{ path: '/a.typ', ranges: [] }]);
    expect(mergeFiles({ '/a.typ': 'a' }, {}, { '/a.typ': 'changed' }).conflicts).toEqual([{ path: '/a.typ', ranges: [] }]);
  });

  it('merges a file both sides created', () => {
    expect(mergeFiles({}, { '/n.typ': 'same\n' }, { '/n.typ': 'same\n' })).toEqual({ changes: {}, conflicts: [] });
    expect(mergeFiles({}, { '/n.typ': 'mine\n' }, { '/n.typ': 'theirs\n' }).conflicts).toEqual([{ path: '/n.typ', ranges: [{ from: 0, to: 5 }] }]);
  });
});
