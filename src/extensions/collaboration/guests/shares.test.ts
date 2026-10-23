// Tests for shares.ts.
import { describe, expect, it, vi } from 'vitest';
import { Shares } from './shares';

const share = { id: 's1', label: 'ACME', sharedBy: 'Ann', createdAt: 1, expiresAt: 2, online: ['Jane (guest)'] };

describe('Shares', () => {
  it('lists, creates and revokes the links of a room, with the session cookie', async () => {
    const send = vi.fn<typeof fetch>(async (_input, init) => {
      if (init?.method === 'POST') return new Response(JSON.stringify({ ...share, token: 'SECRET' }), { status: 201 });
      if (init?.method === 'DELETE') return new Response(null, { status: 204 });
      return new Response(JSON.stringify({ shares: [share, { label: 'broken' }] }));
    });
    const shares = new Shares('wss://editor.example.org', 'gitlab:g/r@main', send);
    const changed = vi.fn();
    shares.onDidChange(changed);
    await shares.refresh();
    expect(shares.shares).toEqual([share]);
    expect(changed).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith('https://editor.example.org/api/rooms/gitlab%3Ag%2Fr%40main/shares', { credentials: 'include', cache: 'no-store' });

    await expect(shares.create('ACME', 7)).resolves.toMatchObject({ token: 'SECRET' });
    expect(send.mock.calls.at(-2)?.[1]).toMatchObject({ method: 'POST', body: '{"label":"ACME","days":7}' });
    await shares.revoke('s1');
    expect(send).toHaveBeenCalledWith('https://editor.example.org/api/rooms/gitlab%3Ag%2Fr%40main/shares/s1', { method: 'DELETE', credentials: 'include' });
  });

  it("rejects with the server's reason, and knows none when it cannot ask", async () => {
    const refusing = new Shares('ws://h', 'r', async () => new Response('This project has 10 guest links, the most it may have; revoke one first.\n', { status: 409 }));
    await expect(refusing.create('x', 1)).rejects.toThrow('the most it may have');
    await refusing.refresh();
    expect(refusing.shares).toEqual([]);
    const offline = new Shares('ws://h', 'r', async () => Promise.reject(new Error('offline')));
    await offline.refresh();
    expect(offline.shares).toEqual([]);
  });
});
