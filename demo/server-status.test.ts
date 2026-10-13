// Tests for server-status.ts.
import { describe, expect, it } from 'vitest';
import { GITLAB_ROOM, SERVER } from './playground';
import { describeServer, probeServer, simulateUpstream } from './server-status';

type Call = { url: string; init?: RequestInit };

/** A fetch that answers from `routes` (by path) and records the calls; unknown paths fail like a closed port. */
function fakeFetch(routes: Record<string, () => Response>) {
  const calls: Call[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const route = routes[new URL(url).pathname];
    if (!route) throw new TypeError('Failed to fetch');
    return route();
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('probeServer', () => {
  it('finds the playground server with its fake GitLab, and whether it has plain rooms', async () => {
    const { fetch, calls } = fakeFetch({
      '/api/info': () => json({ plainRooms: true }),
      '/playground': () => json({ project: 'demo/report', room: GITLAB_ROOM }),
    });
    await expect(probeServer(fetch)).resolves.toEqual({ kind: 'gitlab', plainRooms: true });
    expect(calls.map((call) => call.url)).toEqual([`${SERVER.http}/api/info`, `${SERVER.http}/playground`]);
  });

  it('a server without the playground endpoints (mise run server:dev) is just a server; plain rooms off', async () => {
    const { fetch } = fakeFetch({ '/api/info': () => json({ plainRooms: false }) });
    await expect(probeServer(fetch)).resolves.toEqual({ kind: 'server', plainRooms: false });
  });

  it('nothing listening: offline', async () => {
    await expect(probeServer(fakeFetch({}).fetch)).resolves.toEqual({ kind: 'offline', plainRooms: false });
  });
});

describe('simulateUpstream', () => {
  it('posts to the playground endpoint and describes the commit', async () => {
    const { fetch, calls } = fakeFetch({
      '/playground/upstream': () => json({ sha: '0123456789abcdef', path: '/chapters/introduction.typ', message: 'Add a paragraph (simulated upstream commit 1)' }),
    });
    await expect(simulateUpstream(GITLAB_ROOM, 'heading', fetch)).resolves.toBe(
      'GitLab: 01234567 “Add a paragraph (simulated upstream commit 1)” changed /chapters/introduction.typ',
    );
    expect(calls[0].init?.method).toBe('POST');
    expect(Object.fromEntries(new URL(calls[0].url).searchParams)).toEqual({ room: GITLAB_ROOM, change: 'heading' });
  });

  it('rejects with the server’s explanation', async () => {
    const { fetch } = fakeFetch({ '/playground/upstream': () => new Response('room must be a GitLab room', { status: 400 }) });
    await expect(simulateUpstream('r1', 'append', fetch)).rejects.toThrow('room must be a GitLab room');
  });
});

describe('describeServer', () => {
  it('local mode needs no server', () => {
    expect(describeServer('local', null).text).toMatch(/no server needed/);
  });

  it('offline in a room: says the copy is local and how to start the server', () => {
    const status = describeServer('collab', 'offline');
    expect(status.level).toBe('warn');
    expect(status.text).toMatch(/not reachable/);
    expect(status.hint).toContain('mise run demo');
  });

  it('GitLab mode on a server without the fake GitLab says which command has it', () => {
    const status = describeServer('gitlab', 'server');
    expect(status.level).toBe('warn');
    expect(status.hint).toContain('mise run demo');
  });

  it('Collaborate mode on a server without plain rooms says it opens only GitLab rooms', () => {
    const status = describeServer('collab', 'server', false);
    expect(status).toMatchObject({ level: 'warn', text: expect.stringMatching(/only GitLab rooms/), hint: 'mise run demo' });
    expect(describeServer('gitlab', 'gitlab', false).level).toBe('ok');
  });

  it('connected', () => {
    expect(describeServer('gitlab', 'gitlab')).toMatchObject({ level: 'ok', text: expect.stringContaining('fake GitLab') });
    expect(describeServer('collab', 'server', true)).toMatchObject({ level: 'ok', text: expect.stringContaining(SERVER.ws) });
  });

  it('a server that came up after the page loaded asks for a reload', () => {
    expect(describeServer('collab', 'reload').text).toMatch(/reload/i);
  });

  it('a server that went away while in the room: edits sync again later', () => {
    expect(describeServer('gitlab', 'lost')).toMatchObject({ level: 'warn', text: expect.stringMatching(/sync again/), hint: 'mise run demo' });
  });
});
