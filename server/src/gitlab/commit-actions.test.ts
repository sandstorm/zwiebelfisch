// Tests for commit-actions.ts.
import { describe, expect, it } from 'vitest';
import { blobSha } from './blob-sha.ts';
import { commitActions } from './commit-actions.ts';

const meta = (base: Record<string, string>, baseAssets: Record<string, string> = {}) => ({
  baseSha: 'b0',
  base,
  baseAssets,
  lastCommits: Object.fromEntries(Object.keys(base).map((path) => [path, `last-${path}`])),
});

describe('commitActions', () => {
  it('updates changed files with their last commit (optimistic concurrency)', () => {
    expect(commitActions(meta({ '/a.typ': 'a', '/b.typ': 'b' }), { texts: { '/a.typ': 'A', '/b.typ': 'b' }, assets: {} })).toEqual([
      { action: 'update', path: '/a.typ', content: 'A', lastCommitId: 'last-/a.typ' },
    ]);
  });

  it('pairs a deleted and a created file of similar content as a move', () => {
    const base = { '/ch1.typ': '= One\nline 1\nline 2\nline 3\n' };
    const texts = { '/chapter.typ': '= One\nline 1\nline 2\nline 3 edited\n' };
    expect(commitActions(meta(base), { texts, assets: {} })).toEqual([
      { action: 'move', path: '/chapter.typ', previousPath: '/ch1.typ', content: texts['/chapter.typ'], lastCommitId: 'last-/ch1.typ' },
    ]);
  });

  it('keeps unrelated deletions and creations apart', () => {
    const actions = commitActions(meta({ '/old.typ': 'one\ntwo\nthree' }), { texts: { '/new.typ': 'something\nelse' }, assets: {} });
    expect(actions.map((action) => action.action)).toEqual(['create', 'delete']);
  });

  it('uploads new bytes, moves renamed repository files, deletes removed ones, skips unchanged ones', () => {
    const same = new Uint8Array([1]);
    const baseAssets = { '/same.png': blobSha(same), '/a.png': 'sha-a', '/gone.png': 'sha-gone' };
    const assets = { '/same.png': same, '/b.png': 'sha-a', '/new.png': new Uint8Array([2]) };
    expect(commitActions(meta({}, baseAssets), { texts: {}, assets })).toEqual([
      { action: 'move', path: '/b.png', previousPath: '/a.png' },
      { action: 'create', path: '/new.png', content: new Uint8Array([2]) },
      { action: 'delete', path: '/gone.png' },
    ]);
  });
});
