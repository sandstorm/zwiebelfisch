// Tests for the playground server (playground.ts).
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Hocuspocus, type onRequestPayload } from '@hocuspocus/server';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { ServerMessage } from '../../../src/extensions/collaboration/model/gitlab-protocol.ts';
import { collabConfiguration } from '../collab-server.ts';
import { FakeGitLab } from '../gitlab/fake-gitlab.ts';
import { PLAYGROUND_PROJECT, PLAYGROUND_ROOM, PlaygroundEndpoints, playgroundOptions, upstreamEdit } from './playground.ts';
import { readProjectFiles } from './project-files.ts';

// The playground's dev-only endpoints, in-process: Hocuspocus without its
// WebSocket server, the fake GitLab behind an injected fetch. No ports.

const INTRO = '/chapters/introduction.typ';
const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

function files() {
  return {
    '/main.typ': '#include "chapters/introduction.typ"\n',
    [INTRO]: '= Introduction <intro>\n\nFirst paragraph.\n',
    '/assets/logo.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
  };
}

/** A playground server with the GitLab room open; `sent`: what it broadcast to the room's clients. */
async function setup() {
  const gitlab = new FakeGitLab(PLAYGROUND_PROJECT, files());
  gitlab.autoBranches = true;
  const server = new Hocuspocus(collabConfiguration({ quiet: true, ...playgroundOptions(gitlab, { appendTo: INTRO }) }));
  const playground = server.configuration.extensions.find((e) => e.extensionName === 'playground') as PlaygroundEndpoints;
  const connection = await server.openDirectConnection(PLAYGROUND_ROOM);
  cleanup.push(() => connection.disconnect());
  const sent: ServerMessage[] = [];
  connection.document!.broadcastStateless = (payload: string) => void sent.push(JSON.parse(payload));
  const text = (path: string) => connection.document!.getMap<Y.Text>('files').get(path)?.toString();
  return { gitlab, server, playground, sent, text };
}

/** A request as Node's HTTP server hands it to Hocuspocus' onRequest; resolves with the response written. */
async function request(server: Hocuspocus, playground: PlaygroundEndpoints, method: string, url: string) {
  const incoming = Object.assign(Readable.from([]), { method, url, headers: {} }) as unknown as IncomingMessage;
  const written: { status?: number; headers?: Record<string, string>; body?: string } = {};
  const response = {
    writeHead: (status: number, headers: Record<string, string>) => Object.assign(written, { status, headers }),
    end: (body: string | Uint8Array) => Object.assign(written, { body: String(body) }),
  } as unknown as ServerResponse;
  const answered = await playground.onRequest({ request: incoming, response, instance: server } as onRequestPayload).then(
    () => false,
    (error: unknown) => {
      if (error !== null) throw error;
      return true; // Hocuspocus' "answered" signal
    },
  );
  return { answered, ...written, json: () => JSON.parse(written.body ?? 'null') };
}

describe('playground endpoints', () => {
  it('GET /playground tells the demo that the fake GitLab is there and which room to open', async () => {
    const { server, playground } = await setup();
    const response = await request(server, playground, 'GET', '/playground');
    expect(response.answered).toBe(true);
    expect(response.status).toBe(200);
    expect(response.headers!['Access-Control-Allow-Origin']).toBe('*');
    expect(response.json()).toEqual({ project: PLAYGROUND_PROJECT, room: PLAYGROUND_ROOM });
  });

  it('a simulated upstream commit lands on the branch and is merged into the open room', async () => {
    const { gitlab, server, playground, sent, text } = await setup();
    const before = gitlab.head('main').sha;
    const response = await request(server, playground, 'POST', `/playground/upstream?room=${encodeURIComponent(PLAYGROUND_ROOM)}`);

    expect(response.status).toBe(200);
    const head = gitlab.head('main');
    expect(head.parent).toBe(before);
    expect(response.json()).toEqual({ sha: head.sha, path: INTRO, message: head.message });
    expect(gitlab.text()[INTRO]).toMatch(/First paragraph\.\n\nUpstream edit 1: .+\n$/);
    expect(text(INTRO)).toBe(gitlab.text()[INTRO]);
    expect(sent).toEqual([{ type: 'gitlab:merged', sha: head.sha }]);
  });

  it('change=heading revises the first heading and keeps its label', async () => {
    const { gitlab, server, playground } = await setup();
    await request(server, playground, 'POST', `/playground/upstream?change=heading&room=${encodeURIComponent(PLAYGROUND_ROOM)}`);
    expect(gitlab.text()[INTRO]).toMatch(/^= Introduction \(upstream revision 1\) <intro>\n/);
  });

  it('a branch nobody opened yet starts at main', async () => {
    const { gitlab, server, playground } = await setup();
    const room = `gitlab:${PLAYGROUND_PROJECT}@fresh`;
    const response = await request(server, playground, 'POST', `/playground/upstream?room=${encodeURIComponent(room)}`);
    expect(response.status).toBe(200);
    expect(Object.keys(gitlab.text('fresh')).sort()).toEqual(Object.keys(files()).sort());
  });

  it.each([
    ['POST', '/playground/upstream?room=plain-room', 400],
    ['POST', `/playground/upstream?room=${encodeURIComponent('gitlab:other/project@main')}`, 404],
    ['GET', `/playground/upstream?room=${encodeURIComponent(PLAYGROUND_ROOM)}`, 405],
  ])('%s %s → %i', async (method, url, status) => {
    const { server, playground } = await setup();
    const response = await request(server, playground, method, url);
    expect(response.status).toBe(status);
    expect(response.headers!['Access-Control-Allow-Origin']).toBe('*');
  });

  it('leaves other requests to the rest of the server', async () => {
    const { server, playground } = await setup();
    expect((await request(server, playground, 'GET', '/')).answered).toBe(false);
  });
});

describe('upstreamEdit', () => {
  it('append adds a numbered paragraph at the end', () => {
    expect(upstreamEdit('= A\n\nText.\n', 'append', 2)).toMatch(/^= A\n\nText\.\n\nUpstream edit 2: .+\n$/);
    expect(upstreamEdit('Text.', 'append', 1)).toMatch(/^Text\.\n\nUpstream edit 1: /);
  });

  it('heading revises the first heading, before its label', () => {
    expect(upstreamEdit('Intro\n== Goals\n= Later\n', 'heading', 3)).toBe('Intro\n== Goals (upstream revision 3)\n= Later\n');
    expect(upstreamEdit('= Intro <intro>\n', 'heading', 1)).toBe('= Intro (upstream revision 1) <intro>\n');
  });

  it('heading falls back to a paragraph when the file has no heading', () => {
    expect(upstreamEdit('Text.\n', 'heading', 1)).toMatch(/Upstream edit 1: /);
  });
});

describe('readProjectFiles', () => {
  it('reads the advanced demo example: Typst files as text, images as bytes', () => {
    const project = readProjectFiles(new URL('../../../demo/examples/advanced/', import.meta.url));
    expect(project['/main.typ']).toEqual(expect.stringContaining('#include "chapters/introduction.typ"'));
    expect(typeof project[INTRO]).toBe('string');
    expect(project['/assets/logo.svg']).toBeInstanceOf(Uint8Array);
  });
});
