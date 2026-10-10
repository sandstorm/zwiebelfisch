import { Hocuspocus, type Document, type Extension, type onStatelessPayload } from '@hocuspocus/server';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { ASSETS_MAP, META_MAP, roomFilePath, type ServerMessage } from '../../../src/collab/gitlab-protocol.ts';
import { connect } from '../../../src/collab/in-process.ts';
import { SharedProject } from '../../../src/collab/shared-project.ts';
import { Project } from '../../../src/core/project/project.ts';
import { sharedToken } from '../auth.ts';
import { collabConfiguration } from '../collab-server.ts';
import { blobSha } from './blob-sha.ts';
import { FakeGitLab } from './fake-gitlab.ts';
import type { GitLabExtension } from './gitlab-extension.ts';
import type { HttpResponse } from './http.ts';

// Integration tests: the collaboration server (Hocuspocus in-process, no
// port) with GitLab-backed rooms against an in-process fake GitLab (injected
// fetch, no network).

const PROJECT = 'group/report';
const ROOM = `gitlab:${PROJECT}@main`;
const MAIN = '/main.typ';
const LOGO = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
const MAIN_TEXT = '= Report\n\nFirst paragraph.\n\nSecond paragraph.\n\nThird paragraph.\n';

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

function initialFiles() {
  return { [MAIN]: MAIN_TEXT, '/ch1.typ': '= One\n\nText of one.\n', '/old.typ': 'old\n', '/img/logo.png': LOGO };
}

/** A server with GitLab rooms and an open room (`doc` is the server's Y.Doc of it). */
async function setup(options: { files?: Record<string, string | Uint8Array>; storage?: Extension } = {}) {
  const gitlab = new FakeGitLab(PROJECT, options.files ?? initialFiles());
  const server = new Hocuspocus(
    collabConfiguration({
      quiet: true,
      storage: options.storage,
      authenticate: sharedToken('room-token'),
      gitlab: { url: gitlab.url, token: gitlab.token, fetch: gitlab.fetch, webhookSecret: 'hook-secret' },
    }),
  );
  const extension = server.configuration.extensions.find((e) => e.extensionName === 'gitlab') as GitLabExtension;
  const connection = await server.openDirectConnection(ROOM);
  cleanup.push(() => connection.disconnect());
  const doc = connection.document!;
  const sent: ServerMessage[] = [];
  doc.broadcastStateless = (payload: string) => void sent.push(JSON.parse(payload));
  return { gitlab, server, extension, connection, doc, sent, ...helpers(extension, doc, sent) };
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
    paths: () => [...doc.getMap('files').keys()].sort(),
    meta: () => doc.getMap(META_MAP).toJSON() as { baseSha: string; base: Record<string, string>; baseAssets: Record<string, string> },
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
    shared.destroy();
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
    const server = new Hocuspocus(collabConfiguration({ quiet: true, storage, gitlab: { url: gitlab.url, token: gitlab.token, fetch: gitlab.fetch } }));
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
    project.apply({ kind: 'rename', from: '/ch1.typ', path: '/chapter-1.typ' });
    project.document('/chapter-1.typ')!.setText('= One\n\nText of one, edited.\n', 'test');
    project.apply({ kind: 'delete', path: '/old.typ' });
    project.apply({ kind: 'create', path: '/new.typ', content: 'new\n' });
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

function pushEvent(secret = 'hook-secret') {
  const body = JSON.stringify({ object_kind: 'push', ref: 'refs/heads/main', project_id: 7, project: { id: 7, path_with_namespace: PROJECT } });
  return {
    method: 'POST',
    url: '/gitlab/webhook',
    header: (name: string) => (name === 'x-gitlab-token' ? secret : null),
    body: async () => body,
  };
}
