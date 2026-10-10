import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hocuspocus, type Extension } from '@hocuspocus/server';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { Project } from '../../src/editor/project.ts';
import { connect } from '../../src/collab/in-process.ts';
import { SharedProject } from '../../src/collab/shared-project.ts';
import { sharedToken } from './auth.ts';
import { collabConfiguration } from './collab-server.ts';

// Everything runs in-process (Hocuspocus without its WebSocket server):
// the sandbox cannot bind ports. Clients are joined to a room's server-side
// Y.Doc directly; the WebSocket path is covered by tests/e2e/collab.spec.ts.

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function database(): string {
  const dir = mkdtempSync(join(tmpdir(), 'typst-collab-'));
  directories.push(dir);
  return join(dir, 'collab.sqlite');
}

const server = (options: Parameters<typeof collabConfiguration>[0]) => new Hocuspocus(collabConfiguration({ quiet: true, ...options }));

describe('collaboration server', () => {
  it('stores a room in SQLite and loads it again after a restart', async () => {
    const file = database();
    const first = server({ database: file });
    const connection = await first.openDirectConnection('report');
    await connection.transact((doc) => {
      const text = new Y.Text();
      doc.getMap('files').set('/main.typ', text);
      text.insert(0, '= Report');
    });
    await connection.disconnect();

    const second = server({ database: file });
    const again = await second.openDirectConnection('report');
    expect((again.document!.getMap('files').get('/main.typ') as Y.Text).toString()).toBe('= Report');
    await again.disconnect();
  });

  it('keeps what a widget client wrote (SharedProject on a Y.Doc synced with the room)', async () => {
    const file = database();
    const first = server({ database: file });
    const connection = await first.openDirectConnection('book');
    const client = new Y.Doc();
    const disconnect = connect(connection.document!, client);
    const project = new Project('/main.typ', { '/main.typ': 'Hello', '/ch1.typ': 'One' });
    const shared = new SharedProject(project, client);
    project.document('/main.typ')!.setText('Hello world', 'test');
    shared.destroy();
    disconnect();
    await connection.disconnect();

    const second = server({ database: file });
    const again = await second.openDirectConnection('book');
    const files = again.document!.getMap<Y.Text>('files');
    expect(Object.fromEntries([...files.entries()].map(([path, text]) => [path, text.toString()]))).toEqual({
      '/main.typ': 'Hello world',
      '/ch1.typ': 'One',
    });
    await again.disconnect();
  });

  it('loads and stores through the storage extension it is given', async () => {
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
    const connection = await server({ storage }).openDirectConnection('notes');
    await connection.transact((doc) => doc.getMap('files').set('/main.typ', new Y.Text('notes')));
    await connection.disconnect();
    expect(stored.has('notes')).toBe(true);

    const again = await server({ storage }).openDirectConnection('notes');
    expect((again.document!.getMap('files').get('/main.typ') as Y.Text).toString()).toBe('notes');
    await again.disconnect();
  });

  it('refuses connections whose token the check rejects', async () => {
    const { onAuthenticate } = collabConfiguration({ authenticate: sharedToken('secret') });
    const payload = (token: string) => ({ token, documentName: 'room' }) as Parameters<NonNullable<typeof onAuthenticate>>[0];
    await expect(onAuthenticate!(payload('wrong'))).rejects.toThrow('Invalid token');
    await expect(onAuthenticate!(payload('secret'))).resolves.toEqual({ user: {} });
  });
});

describe('sharedToken', () => {
  it('lets everyone in while no token is configured', async () => {
    await expect(sharedToken(undefined)('', 'room')).resolves.toEqual({});
  });
});
