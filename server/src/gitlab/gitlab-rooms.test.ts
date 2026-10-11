// Tests for GitLab-backed rooms: the collaboration server with a FakeGitLab, in-process.
import { Hocuspocus, type Document, type Extension, type onStatelessPayload } from '@hocuspocus/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { ASSETS_MAP, META_MAP, roomFilePath, type RoomChanges, type ServerMessage } from '../../../src/core/room-protocol/room-protocol.ts';
import { connect } from '../../../src/extensions/collaboration/model/in-process.ts';
import { SharedProject } from '../../../src/extensions/collaboration/model/shared-project.ts';
import { Project } from '../../../src/core/project/project.ts';
import { ProjectPath } from '../../../src/core/paths/paths.ts';
import { sharedToken } from '../auth.ts';
import { collabConfiguration } from '../collab-server.ts';
import { blobSha } from './blob-sha.ts';
import { FakeGitLab } from './fake-gitlab.ts';
import { parseAutoCommit, type GitLabExtension } from './gitlab-extension.ts';
import { LEAVE_DELAY } from './gitlab-room.ts';
import type { HttpResponse } from '../http.ts';

const path = ProjectPath.of;

// Integration tests: the collaboration server (Hocuspocus in-process, no
// port) with GitLab-backed rooms against an in-process fake GitLab (injected
// fetch, no network).

const PROJECT = 'group/report';
const ROOM = `gitlab:${PROJECT}@main`;
const MAIN = path('/main.typ');
const LOGO = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
const MAIN_TEXT = '= Report\n\nFirst paragraph.\n\nSecond paragraph.\n\nThird paragraph.\n';

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
  vi.useRealTimers();
});

/** Fake timers and clock (from 10:00), for what the rooms do after a while. */
function fakeTime() {
  vi.useFakeTimers({ now: new Date('2026-10-11T10:00:00Z'), toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
}
const AT_TEN = Date.parse('2026-10-11T10:00:00Z');

function initialFiles() {
  return { [MAIN]: MAIN_TEXT, '/ch1.typ': '= One\n\nText of one.\n', '/old.typ': 'old\n', '/img/logo.png': LOGO };
}

/** A server with GitLab rooms and an open room (`doc` is the server's Y.Doc of it); no auto-commit unless asked for. */
async function setup(options: { files?: Record<string, string | Uint8Array>; storage?: Extension; autoCommit?: number | false } = {}) {
  const gitlab = new FakeGitLab(PROJECT, options.files ?? initialFiles());
  const server = new Hocuspocus(
    collabConfiguration({
      quiet: true,
      storage: options.storage,
      authenticate: sharedToken('room-token'),
      gitlab: { url: gitlab.url, token: gitlab.token, fetch: gitlab.fetch, webhookSecret: 'hook-secret', autoCommit: options.autoCommit ?? false },
    }),
  );
  const extension = server.configuration.extensions.find((e) => e.extensionName === 'gitlab') as GitLabExtension;
  const connection = await server.openDirectConnection(ROOM);
  cleanup.push(() => connection.disconnect());
  const doc = connection.document!;
  const sent: ServerMessage[] = [];
  doc.broadcastStateless = (payload: string) => void sent.push(JSON.parse(payload));
  /** Changes `doc` as `name` would, through a connection of their own (authenticated with name and email). */
  const editAs = async (name: string, change: (doc: Y.Doc) => void) => {
    const own = await server.openDirectConnection(ROOM, { user: { name, email: `${name.toLowerCase()}@example.com` } });
    cleanup.push(() => own.disconnect());
    await own.transact(change);
    return own;
  };
  return { gitlab, server, extension, connection, doc, sent, editAs, ...helpers(extension, doc, sent) };
}

function helpers(extension: GitLabExtension, doc: Document, sent: ServerMessage[]) {
  return {
    /** A client pressing 'Save version'; resolves with what the server sent back or broadcast. */
    async save(message?: string, user: { name: string; email?: string } = { name: 'Ann', email: 'ann@example.com' }) {
      sent.length = 0;
      const connection = { context: { user: {} }, sendStateless: (payload: string) => void sent.push(JSON.parse(payload)) };
      const payload = JSON.stringify({ type: 'gitlab:save', message, author: user });
      await extension.onStateless({ documentName: ROOM, document: doc, connection, payload } as unknown as onStatelessPayload);
      return [...sent];
    },
    text: (path: string) => doc.getMap<Y.Text>('files').get(path)?.toString(),
    changes: () => (doc.getMap(META_MAP).get('changes') ?? null) as RoomChanges | null,
    paths: () => [...doc.getMap('files').keys()].sort(),
    meta: () =>
      doc.getMap(META_MAP).toJSON() as {
        baseSha: string;
        base: Record<string, string>;
        baseAssets: Record<string, string>;
        conflict?: { sha: string; paths: string[] } | null;
        autoCommit: number | null;
      },
    edit(path: string, from: string, to: string) {
      const text = doc.getMap<Y.Text>('files').get(path)!;
      const at = text.toString().indexOf(from);
      expect(at).toBeGreaterThanOrEqual(0);
      text.delete(at, from.length);
      text.insert(at, to);
    },
    get: (path: string, token = 'room-token') =>
      extension.handle({
        method: 'GET',
        url: roomFilePath(ROOM, path),
        header: (name) => (name === 'authorization' ? `Bearer ${token}` : null),
        body: async () => '',
      }) as Promise<HttpResponse>,
  };
}

/** A widget client joined to the room's Y.Doc (its Project, as the widget keeps it). */
function widgetClient(doc: Y.Doc) {
  const ydoc = new Y.Doc();
  const disconnect = connect(doc, ydoc);
  const project = new Project(MAIN, {});
  const shared = new SharedProject(project, ydoc);
  cleanup.push(() => {
    shared.dispose();
    disconnect();
  });
  return project;
}

describe('GitLab rooms: loading', () => {
  it('loads the branch into a new room: .typ files as text, other files by blob sha, the base in meta', async () => {
    const { gitlab, paths, text, meta, doc } = await setup();
    expect(paths()).toEqual(['/ch1.typ', MAIN, '/old.typ']);
    expect(text(MAIN)).toBe(MAIN_TEXT);
    expect(doc.getMap(ASSETS_MAP).toJSON()).toEqual({ '/img/logo.png': blobSha(LOGO) });
    expect(meta().baseSha).toBe(gitlab.head('main').sha);
    expect(meta().base[MAIN]).toBe(MAIN_TEXT);
    expect(meta().baseAssets).toEqual({ '/img/logo.png': blobSha(LOGO) });
  });

  it('reads every page of a large tree', async () => {
    const files: Record<string, string> = { [MAIN]: 'main' };
    for (let i = 0; i < 150; i++) files[`/data/${String(i).padStart(3, '0')}.csv`] = `row ${i}`;
    const { gitlab, doc } = await setup({ files });
    expect(doc.getMap(ASSETS_MAP).size).toBe(150);
    expect(gitlab.requests.filter((request) => request.startsWith('GET /repository/tree')).length).toBeGreaterThan(1);
  });

  it('serves the other files over HTTP to holders of a room token, blobs cached by sha', async () => {
    const { gitlab, get } = await setup();
    const response = await get('/img/logo.png');
    expect(response.status).toBe(200);
    expect(response.headers['Content-Type']).toBe('image/png');
    expect([...(response.body as Uint8Array)]).toEqual([...LOGO]);
    await get('/img/logo.png');
    expect(gitlab.requests.filter((request) => request.includes('/repository/blobs/')).length).toBe(1);
    expect((await get('/img/logo.png', 'wrong')).status).toBe(401);
    expect((await get('/missing.png')).status).toBe(404);
  });

  it('a stored room opens with its own state and merges what was pushed meanwhile', async () => {
    const stored = new Map<string, Uint8Array>();
    const storage: Extension = {
      async onLoadDocument({ documentName, document }) {
        const state = stored.get(documentName);
        if (state) Y.applyUpdate(document, state);
      },
      async onStoreDocument({ documentName, document }) {
        stored.set(documentName, Y.encodeStateAsUpdate(document));
      },
    };
    const first = await setup({ storage });
    first.edit(MAIN, '= Report', '= Room report');
    await first.connection.disconnect();
    expect(stored.has(ROOM)).toBe(true);

    // The same repository, pushed to while the room was closed.
    const gitlab = first.gitlab;
    gitlab.push('main', { [MAIN]: MAIN_TEXT.replace('Third', 'Last') });
    const server = new Hocuspocus(collabConfiguration({ quiet: true, storage, gitlab: { url: gitlab.url, token: gitlab.token, fetch: gitlab.fetch, autoCommit: false } }));
    const again = await server.openDirectConnection(ROOM);
    cleanup.push(() => again.disconnect());
    expect((again.document!.getMap('files').get(MAIN) as Y.Text).toString()).toBe(MAIN_TEXT.replace('= Report', '= Room report').replace('Third', 'Last'));
  });
});

describe('GitLab rooms: saving', () => {
  it('commits the changed files as one commit by the saving user and moves the base', async () => {
    const { gitlab, save, edit, meta } = await setup();
    edit(MAIN, 'First', 'Opening');
    const messages = await save('Reword the opening');
    const head = gitlab.head('main');
    expect(messages).toEqual([{ type: 'gitlab:saved', sha: head.sha, author: 'Ann' }]);
    expect(head.message).toBe('Reword the opening');
    expect(head.author).toEqual({ name: 'Ann', email: 'ann@example.com' });
    expect(gitlab.text()[MAIN]).toBe(MAIN_TEXT.replace('First', 'Opening'));
    expect(meta()).toMatchObject({ baseSha: head.sha, base: { [MAIN]: MAIN_TEXT.replace('First', 'Opening') } });
  });

  it('has nothing to commit without changes, and a default message otherwise', async () => {
    const { gitlab, save, edit } = await setup();
    expect(await save()).toEqual([{ type: 'gitlab:unchanged' }]);
    edit(MAIN, 'First', '1st');
    await save('  ');
    expect(gitlab.head('main').message).toBe('Edit via Typst editor');
  });

  it('commits creates, renames and deletes made by a widget client', async () => {
    const { gitlab, save, doc } = await setup();
    const project = widgetClient(doc);
    project.apply({ kind: 'rename', from: path('/ch1.typ'), path: path('/chapter-1.typ') });
    project.document(path('/chapter-1.typ'))!.setText('= One\n\nText of one, edited.\n', 'test');
    project.apply({ kind: 'delete', path: path('/old.typ') });
    project.apply({ kind: 'create', path: path('/new.typ'), content: 'new\n' });
    const commits = gitlab.requests.filter((request) => request.startsWith('POST'));
    expect((await save())[0].type).toBe('gitlab:saved');
    expect(gitlab.requests.filter((request) => request.startsWith('POST')).length).toBe(commits.length + 1);
    expect(gitlab.text()).toEqual({
      [MAIN]: MAIN_TEXT,
      '/chapter-1.typ': '= One\n\nText of one, edited.\n',
      '/new.typ': 'new\n',
      '/img/logo.png': new TextDecoder().decode(LOGO),
    });
  });

  it('commits uploaded, renamed and deleted assets', async () => {
    const { gitlab, save, doc, get, meta } = await setup({ files: { [MAIN]: 'main', '/a.png': LOGO, '/b.png': new Uint8Array([9]) } });
    const assets = doc.getMap(ASSETS_MAP);
    const upload = new Uint8Array([1, 2, 3]);
    assets.set('/img/upload.png', upload);
    assets.set('/renamed.png', assets.get('/a.png'));
    assets.delete('/a.png');
    assets.delete('/b.png');
    expect([...((await get('/img/upload.png')).body as Uint8Array)]).toEqual([1, 2, 3]);
    expect((await save())[0].type).toBe('gitlab:saved');
    const files = gitlab.head('main').files;
    expect([...files.keys()].sort()).toEqual(['/img/upload.png', MAIN, '/renamed.png']);
    expect([...files.get('/img/upload.png')!]).toEqual([1, 2, 3]);
    expect(assets.get('/img/upload.png')).toBe(blobSha(upload));
    expect(meta().baseAssets).toEqual({ '/img/upload.png': blobSha(upload), '/renamed.png': blobSha(LOGO) });
  });
});

describe('GitLab rooms: upstream changes', () => {
  it('merges an upstream commit into the room and commits on top of it', async () => {
    const { gitlab, save, edit, text } = await setup();
    edit(MAIN, 'First', 'Opening');
    gitlab.push('main', { [MAIN]: MAIN_TEXT.replace('Third', 'Last'), '/ch2.typ': 'two' });
    const messages = await save();
    expect(messages).toEqual([{ type: 'gitlab:saved', sha: gitlab.head('main').sha, author: 'Ann' }]);
    const both = MAIN_TEXT.replace('First', 'Opening').replace('Third', 'Last');
    expect(gitlab.text()[MAIN]).toBe(both);
    expect(text(MAIN)).toBe(both);
    expect(text('/ch2.typ')).toBe('two');
  });

  it('applies upstream as small edits, so text around them keeps its identity', async () => {
    const { gitlab, doc, extension, edit, text } = await setup();
    const shared = doc.getMap<Y.Text>('files').get(MAIN)!;
    edit(MAIN, 'First', 'Opening');
    const cursor = Y.createRelativePositionFromTypeIndex(shared, shared.toString().indexOf('paragraph'));
    gitlab.push('main', { [MAIN]: MAIN_TEXT.replace('Third', 'Last') });
    await extension.handle(pushEvent());
    expect(text(MAIN)).toBe(MAIN_TEXT.replace('First', 'Opening').replace('Third', 'Last'));
    expect(Y.createAbsolutePositionFromRelativePosition(cursor, doc)!.index).toBe(text(MAIN)!.indexOf('paragraph'));
  });

  it('merges a push reported by the webhook and tells the clients', async () => {
    const { gitlab, extension, sent, text, meta } = await setup();
    const sha = gitlab.push('main', { '/ch1.typ': 'pushed' });
    const response = await extension.handle(pushEvent());
    expect(response?.status).toBe(202);
    expect(text('/ch1.typ')).toBe('pushed');
    expect(meta().baseSha).toBe(sha);
    expect(sent).toEqual([{ type: 'gitlab:merged', sha }]);
    expect((await extension.handle(pushEvent('wrong')))?.status).toBe(401);
  });

  it('retries when a push lands between its check and its commit (GitLab refuses the stale file)', async () => {
    const { gitlab, save, edit, text } = await setup();
    edit(MAIN, 'First', 'Opening');
    gitlab.failNextCommit = { status: 0, message: '', push: { [MAIN]: MAIN_TEXT.replace('Second', '2nd') } };
    expect((await save())[0].type).toBe('gitlab:saved');
    expect(gitlab.text()[MAIN]).toBe(MAIN_TEXT.replace('First', 'Opening').replace('Second', '2nd'));
    expect(text(MAIN)).toBe(gitlab.text()[MAIN]);
  });

  it('takes in a push to another file that landed just before its commit', async () => {
    const { gitlab, save, edit, text, meta } = await setup();
    edit(MAIN, 'First', 'Opening');
    gitlab.failNextCommit = { status: 0, message: '', push: { '/ch1.typ': 'pushed' } };
    expect((await save())[0].type).toBe('gitlab:saved');
    expect(text('/ch1.typ')).toBe('pushed');
    expect(meta().baseSha).toBe(gitlab.head('main').sha);
  });

  it('reports a true conflict to the clients and keeps the room and the branch as they are', async () => {
    const { gitlab, save, edit, text, meta } = await setup();
    const before = gitlab.head('main').sha;
    edit(MAIN, 'Second paragraph.', 'Mine.');
    const upstream = gitlab.push('main', { [MAIN]: MAIN_TEXT.replace('Second paragraph.', 'Theirs.') });
    const messages = await save();
    const mine = MAIN_TEXT.replace('Second paragraph.', 'Mine.');
    const from = mine.indexOf('Mine.');
    expect(messages).toEqual([{ type: 'gitlab:conflict', sha: upstream, files: [{ path: MAIN, ranges: [{ from, to: from + 'Mine.\n'.length }] }] }]);
    expect(text(MAIN)).toBe(mine);
    expect(gitlab.head('main').sha).toBe(upstream);
    expect(meta().baseSha).toBe(before);
  });
});

describe('GitLab rooms: what is not in GitLab yet', () => {
  /** Replaces `from` by `to` in the shared text of `path` of `doc`. */
  const replace = (doc: Y.Doc, path: string, from: string, to: string) => {
    const text = doc.getMap<Y.Text>('files').get(path)!;
    const at = text.toString().indexOf(from);
    text.delete(at, from.length);
    text.insert(at, to);
  };

  it('tells the room which files changed, since when and by whom, shortly after the edits', async () => {
    fakeTime();
    const { editAs, changes, save } = await setup();
    await editAs('Ann', (doc) => replace(doc, MAIN, 'First', 'Opening'));
    expect(changes()).toBeNull();
    await vi.advanceTimersByTimeAsync(500);
    expect(changes()).toEqual({ files: [{ path: MAIN, kind: 'modified' }], since: AT_TEN, editors: ['Ann'] });

    await vi.advanceTimersByTimeAsync(60_000);
    await editAs('Bob', (doc) => {
      const files = doc.getMap<Y.Text>('files');
      files.delete('/old.typ');
      files.set('/new.typ', new Y.Text('new\n'));
      doc.getMap(ASSETS_MAP).set('/img/upload.png', new Uint8Array([1]));
    });
    await editAs('Ann', (doc) => replace(doc, MAIN, 'Opening', 'Start'));
    await vi.advanceTimersByTimeAsync(500);
    expect(changes()).toEqual({
      files: [
        { path: '/img/upload.png', kind: 'added' },
        { path: MAIN, kind: 'modified' },
        { path: '/new.typ', kind: 'added' },
        { path: '/old.typ', kind: 'deleted' },
      ],
      since: AT_TEN,
      editors: ['Ann', 'Bob'],
    });

    expect((await save())[0].type).toBe('gitlab:saved');
    expect(changes()).toBeNull();
  });

  it('is clean again when the edits are undone, and starts over with the next edit', async () => {
    fakeTime();
    const { editAs, changes } = await setup();
    await editAs('Ann', (doc) => replace(doc, MAIN, 'First', 'Opening'));
    await vi.advanceTimersByTimeAsync(500);
    await editAs('Bob', (doc) => replace(doc, MAIN, 'Opening', 'First'));
    await vi.advanceTimersByTimeAsync(500);
    expect(changes()).toBeNull();
    await vi.advanceTimersByTimeAsync(60_000);
    await editAs('Bob', (doc) => replace(doc, MAIN, 'First', '1st'));
    await vi.advanceTimersByTimeAsync(500);
    expect(changes()).toMatchObject({ since: AT_TEN + 61_000, editors: ['Bob'] });
  });

  it('names a client by the name it publishes in the awareness when the connection does not know it (else nobody)', async () => {
    fakeTime();
    const { extension, doc, changes } = await setup();
    const connection = { context: {} };
    const states = new Map([[7, { user: { name: 'Cleo', color: '#fff' } }]]);
    await extension.onAwarenessUpdate({ connection, added: [7], updated: [], removed: [], awareness: { getStates: () => states } } as never);
    doc.transact(() => replace(doc, MAIN, 'First', 'Opening'), { source: 'connection', connection });
    doc.transact(() => replace(doc, MAIN, 'Second', '2nd'), { source: 'connection', connection: { context: {} } });
    await vi.advanceTimersByTimeAsync(500);
    expect(changes()?.editors).toEqual(['Cleo']);
  });

  it('names the other editors as co-authors of a save', async () => {
    const { gitlab, editAs, save } = await setup();
    await editAs('Bob', (doc) => replace(doc, MAIN, 'First', 'Opening'));
    await editAs('Cleo', (doc) => replace(doc, MAIN, 'Second', '2nd'));
    await save('Reword', { name: 'Ann', email: 'ann@example.com' });
    expect(gitlab.head('main').message).toBe('Reword\n\nCo-authored-by: Bob <bob@example.com>\nCo-authored-by: Cleo <cleo@example.com>');
  });

  it('keeps the editors when a commit fails', async () => {
    fakeTime();
    const { gitlab, editAs, changes, save } = await setup();
    await editAs('Ann', (doc) => replace(doc, MAIN, 'First', 'Opening'));
    gitlab.failNextCommit = { status: 500, message: 'down' };
    expect((await save())[0]).toEqual({ type: 'gitlab:error', message: expect.stringContaining('down') });
    expect(changes()).toMatchObject({ since: AT_TEN, editors: ['Ann'] });
  });
});

describe('GitLab rooms: auto-commit', () => {
  const MINUTE = 60_000;
  const replace = (doc: Y.Doc, path: string, from: string, to: string) => {
    const text = doc.getMap<Y.Text>('files').get(path)!;
    const at = text.toString().indexOf(from);
    text.delete(at, from.length);
    text.insert(at, to);
  };

  it('commits on the branch itself after the room was idle: by who edited most, the others as co-authors', async () => {
    fakeTime();
    const { gitlab, editAs, changes, sent, meta } = await setup({ autoCommit: 10 });
    expect(meta().autoCommit).toBe(10);
    const parent = gitlab.head('main').sha;
    await editAs('Ann', (doc) => replace(doc, MAIN, 'First', 'Opening'));
    await editAs('Bob', (doc) => doc.getMap<Y.Text>('files').set('/chapters/new.typ', new Y.Text('new\n')));
    await vi.advanceTimersByTimeAsync(9 * MINUTE);
    await editAs('Bob', (doc) => replace(doc, '/chapters/new.typ', 'new', 'newer'));
    await vi.advanceTimersByTimeAsync(9 * MINUTE);
    expect(gitlab.head('main').sha).toBe(parent);

    await vi.advanceTimersByTimeAsync(1 * MINUTE);
    const head = gitlab.head('main');
    expect(head.parent).toBe(parent);
    expect(head.message).toBe('Edits by Ann, Bob: chapters/new.typ, main.typ\n\nCo-authored-by: Ann <ann@example.com>');
    expect(head.author).toEqual({ name: 'Bob', email: 'bob@example.com' });
    expect(gitlab.text()['/chapters/new.typ']).toBe('newer\n');
    expect(sent).toEqual([{ type: 'gitlab:saved', sha: head.sha, author: 'Bob', automatic: true }]);
    expect(changes()).toBeNull();
  });

  it('names at most three files in the message', async () => {
    fakeTime();
    const { gitlab, editAs } = await setup({ autoCommit: 1 });
    await editAs('Ann', (doc) => {
      for (const name of ['a', 'b', 'c', 'd', 'e']) doc.getMap<Y.Text>('files').set(`/${name}.typ`, new Y.Text(name));
    });
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(gitlab.head('main').message).toBe('Edits by Ann: a.typ, b.typ, c.typ and 2 more');
  });

  it('commits a little while after the last user left, unless someone is back by then', async () => {
    fakeTime();
    const { gitlab, connection, editAs } = await setup({ autoCommit: 10 });
    const parent = gitlab.head('main').sha;
    const ann = await editAs('Ann', (doc) => replace(doc, MAIN, 'First', 'Opening'));
    await connection.disconnect();
    const leaving = ann.disconnect();
    await vi.advanceTimersByTimeAsync(LEAVE_DELAY - 1000);
    // back before the delay is over (a reload): no commit
    const back = await editAs('Ann', () => {});
    await vi.advanceTimersByTimeAsync(2000);
    await leaving;
    expect(gitlab.head('main').sha).toBe(parent);

    const leavingAgain = back.disconnect();
    await vi.advanceTimersByTimeAsync(LEAVE_DELAY);
    await leavingAgain;
    expect(gitlab.head('main').message).toBe('Edits by Ann: main.typ');
    await vi.advanceTimersByTimeAsync(5000);
  });

  it('never commits by itself when off', async () => {
    fakeTime();
    const { gitlab, connection, editAs, meta } = await setup({ autoCommit: false });
    expect(meta().autoCommit).toBeNull();
    const parent = gitlab.head('main').sha;
    const ann = await editAs('Ann', (doc) => replace(doc, MAIN, 'First', 'Opening'));
    await vi.advanceTimersByTimeAsync(60 * MINUTE);
    await connection.disconnect();
    await ann.disconnect();
    await vi.advanceTimersByTimeAsync(LEAVE_DELAY);
    expect(gitlab.head('main').sha).toBe(parent);
  });

  it('is blocked by a conflict, which stays in the room until a merge succeeds', async () => {
    fakeTime();
    const { gitlab, editAs, sent, meta, changes } = await setup({ autoCommit: 10 });
    await editAs('Ann', (doc) => replace(doc, MAIN, 'Second paragraph.', 'Mine.'));
    const upstream = gitlab.push('main', { [MAIN]: MAIN_TEXT.replace('Second paragraph.', 'Theirs.') });
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    expect(sent).toEqual([expect.objectContaining({ type: 'gitlab:conflict', sha: upstream })]);
    expect(meta().conflict).toEqual({ sha: upstream, paths: [MAIN] });
    expect(gitlab.head('main').sha).toBe(upstream);
    expect(changes()?.files).toEqual([{ path: MAIN, kind: 'modified' }]);

    // the lines are made to match: the next idle commit merges and commits the rest
    await editAs('Ann', (doc) => {
      replace(doc, MAIN, 'Mine.', 'Theirs.');
      replace(doc, MAIN, 'First', 'Opening');
    });
    sent.length = 0;
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    expect(meta().conflict).toBeNull();
    expect(sent).toEqual([expect.objectContaining({ type: 'gitlab:saved', automatic: true })]);
    expect(gitlab.text()[MAIN]).toBe(MAIN_TEXT.replace('Second paragraph.', 'Theirs.').replace('First', 'Opening'));
  });

  it('reads its setting from the environment', () => {
    expect(parseAutoCommit(undefined)).toBeUndefined();
    expect(parseAutoCommit(' ')).toBeUndefined();
    expect(parseAutoCommit('off')).toBe(false);
    expect(parseAutoCommit('0')).toBe(false);
    expect(parseAutoCommit('5')).toBe(5);
    expect(parseAutoCommit('0.5')).toBe(0.5);
    expect(() => parseAutoCommit('soon')).toThrow(/TYPST_GITLAB_AUTO_COMMIT/);
  });
});

function pushEvent(secret = 'hook-secret') {
  const body = JSON.stringify({ object_kind: 'push', ref: 'refs/heads/main', project_id: 7, project: { id: 7, path_with_namespace: PROJECT } });
  return {
    method: 'POST',
    url: '/gitlab/webhook',
    header: (name: string) => (name === 'x-gitlab-token' ? secret : null),
    body: async () => body,
  };
}
