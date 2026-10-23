// Tests for gitlab-history.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { ProjectPath } from '../../../core/paths/paths';
import { META_MAP } from '../room-protocol';
import { GitLabHistory } from './gitlab-history';

const ROOM = 'gitlab:group/report@main:/reports/q1';
const SHA = '3f2a91c0aa2b4f7d9e1c0b8a7f6e5d4c3b2a1f00';

function setup(answer: (url: string) => Response) {
  const fetched: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    fetched.push({ url, init });
    return answer(url);
  });
  const ydoc = new Y.Doc();
  ydoc.getMap(META_MAP).set('baseSha', 'a');
  return { history: new GitLabHistory('https://zwf.test', ROOM, ydoc), fetched, ydoc };
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

afterEach(() => void vi.unstubAllGlobals());

describe('GitLabHistory', () => {
  it('reads a page of commits of a scope, with the session cookie, as history items', async () => {
    const { history, fetched } = setup(() =>
      json({ commits: [{ sha: SHA, parents: ['b'], message: 'Fix keys\n\nCo-authored-by: Bob <b@x>', at: 1000, people: ['Ann', 'Bob'] }], cursor: 'next' }),
    );
    const page = await history.provideHistoryItems({ scope: { kind: 'folder', path: ProjectPath.of('/reports/q1/chapters') }, limit: 50 });
    expect(fetched[0].url).toBe(`https://zwf.test/api/rooms/${encodeURIComponent(ROOM)}/history?path=%2Freports%2Fq1%2Fchapters%2F&limit=50`);
    expect(fetched[0].init).toEqual({ credentials: 'include' });
    expect(page).toEqual({
      items: [{ id: SHA, parentIds: ['b'], subject: 'Fix keys', message: 'Fix keys\n\nCo-authored-by: Bob <b@x>', displayId: '3f2a91c', author: 'Ann', coAuthors: ['Bob'], timestamp: 1000 }],
      cursor: 'next',
    });

    await history.provideHistoryItems({ cursor: 'next' });
    expect(fetched[1].url).toBe(`https://zwf.test/api/rooms/${encodeURIComponent(ROOM)}/history?cursor=next`);
  });

  it('lists the files a commit changed, a rename with where it was', async () => {
    const { history, fetched } = setup(() =>
      json({ files: [{ path: '/a.typ', kind: 'modified' }, { path: '/b.typ', previousPath: '/old.typ', kind: 'renamed' }] }),
    );
    expect(await history.provideHistoryItemChanges(SHA)).toEqual([
      { path: '/a.typ', kind: 'modified' },
      { path: '/b.typ', originalPath: '/old.typ', kind: 'renamed' },
    ]);
    expect(fetched[0].url).toBe(`https://zwf.test/api/rooms/${encodeURIComponent(ROOM)}/compare?sha=${SHA}`);
  });

  it('reads a file at a commit; undefined when it was not there; rejects on a failure', async () => {
    const { history, fetched } = setup((url) => (url.includes('missing') ? new Response('', { status: 404 }) : url.includes('broken') ? new Response('', { status: 502 }) : new Response('= Old\n')));
    expect(new TextDecoder().decode(await history.provideFileContent(SHA, ProjectPath.of('/main.typ')))).toBe('= Old\n');
    expect(fetched[0].url).toBe(`https://zwf.test/api/rooms/${encodeURIComponent(ROOM)}/files/main.typ?ref=${SHA}`);
    expect(await history.provideFileContent(SHA, ProjectPath.of('/missing.typ'))).toBeUndefined();
    await expect(history.provideFileContent(SHA, ProjectPath.of('/broken.typ'))).rejects.toThrow('HTTP 502');
  });

  it('tells when the room’s base commit moves', () => {
    const { history, ydoc } = setup(() => json({}));
    const moved = vi.fn();
    history.onDidChangeCurrentHistoryItem(moved);
    ydoc.getMap(META_MAP).set('changes', null);
    expect(moved).not.toHaveBeenCalled();
    ydoc.getMap(META_MAP).set('baseSha', 'b');
    expect(moved).toHaveBeenCalledTimes(1);
    history.dispose();
    ydoc.getMap(META_MAP).set('baseSha', 'c');
    expect(moved).toHaveBeenCalledTimes(1);
  });
});
