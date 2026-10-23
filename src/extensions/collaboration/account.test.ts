// Tests for account.ts.
import { describe, expect, it, vi } from 'vitest';
import { Account, collaborationWebSocketUrl, serverHttpBase } from './account';

const ann = { provider: 'gitlab', id: '2', name: 'Ann', username: 'ann', email: 'ann@gitlab.test' };

/** A server answering /api/me with `me` (null: 401) and /api/auth/logout with 204. */
function server(me: unknown, status = 200) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url.endsWith('/api/auth/logout')) return new Response(null, { status: 204 });
    if (me === null) return new Response('Not signed in', { status: 401 });
    return new Response(JSON.stringify(me), { status });
  });
}

describe('Account', () => {
  it('asks the server who is signed in, sending the session cookie', async () => {
    const send = server(ann);
    const account = new Account('wss://editor.example.org/collab/', send);
    expect(account.identity).toBeUndefined();
    const changed = vi.fn();
    account.onDidChange(changed);
    await expect(account.refresh()).resolves.toEqual(ann);
    expect(account.identity).toEqual(ann);
    expect(changed).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith('https://editor.example.org/collab/api/me', { credentials: 'include' });
  });

  it('joins as a guest with a link\'s secret, and tells a refused link', async () => {
    const jane = { provider: 'guest', id: 'share/1', name: 'Jane (guest)' };
    const send = vi.fn<typeof fetch>(async (input) =>
      String(input).endsWith('/api/public/guest/join') ? new Response(null, { status: 204 }) : new Response(JSON.stringify(jane)),
    );
    const account = new Account('ws://127.0.0.1:1234', send);
    await expect(account.joinAsGuest('SECRET', 'Jane')).resolves.toEqual(jane);
    expect(account.isGuest).toBe(true);
    expect(send).toHaveBeenCalledWith('http://127.0.0.1:1234/api/public/guest/join', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: '{"token":"SECRET","name":"Jane"}',
    });

    const refused = new Account('ws://127.0.0.1:1234', async () => new Response('This link is invalid or has expired.\n', { status: 404 }));
    await expect(refused.joinAsGuest('OLD', 'Jane')).rejects.toThrow('This link is invalid or has expired.');
    expect(refused.isGuest).toBe(false);
  });

  it('is signed out when the server says 401', async () => {
    const account = new Account('ws://127.0.0.1:1234', server(null));
    await expect(account.refresh()).resolves.toBeNull();
    expect(account.identity).toBeNull();
  });

  it('rejects when the server cannot say (and knows nothing then)', async () => {
    const account = new Account('ws://127.0.0.1:1234', server({}, 502));
    await expect(account.refresh()).rejects.toThrow('HTTP 502');
    expect(account.identity).toBeUndefined();
  });

  it('takes nothing for an identity that is not one', async () => {
    await expect(new Account('ws://h', server({ provider: 'gitlab', name: 'No id' })).refresh()).resolves.toBeNull();
    await expect(new Account('ws://h', server({ provider: 'gitlab', id: '7', name: '', email: 3 })).refresh()).resolves.toEqual({
      provider: 'gitlab',
      id: '7',
      name: '7',
    });
  });

  it('signs in at the server, coming back to the page', () => {
    const account = new Account('ws://127.0.0.1:1234', server(null));
    expect(account.signInUrl('http://127.0.0.1:5199/?room=r1')).toBe(
      `http://127.0.0.1:1234/api/public/auth/login?return=${encodeURIComponent('http://127.0.0.1:5199/?room=r1')}`,
    );
  });

  it('signs out (a session already gone too: 401)', async () => {
    const signedOut = new Account('ws://127.0.0.1:1234', async () => new Response('Not signed in', { status: 401 }));
    await expect(signedOut.signOut()).resolves.toBeUndefined();
    expect(signedOut.identity).toBeNull();
  });

  it('signs out', async () => {
    const send = server(ann);
    const account = new Account('ws://127.0.0.1:1234', send);
    await account.refresh();
    await account.signOut();
    expect(account.identity).toBeNull();
    expect(send).toHaveBeenLastCalledWith('http://127.0.0.1:1234/api/auth/logout', { method: 'POST', credentials: 'include' });
  });
});

describe('the server URL', () => {
  it('over HTTP: the same host and path', () => {
    expect(serverHttpBase('ws://127.0.0.1:1234')).toBe('http://127.0.0.1:1234');
    expect(serverHttpBase('wss://collab.example.org/')).toBe('https://collab.example.org');
  });

  it('the collaboration WebSocket', () => {
    expect(collaborationWebSocketUrl('ws://127.0.0.1:1234')).toBe('ws://127.0.0.1:1234/api/collaboration');
    expect(collaborationWebSocketUrl('wss://editor.example.org/collab/')).toBe('wss://editor.example.org/collab/api/collaboration');
  });
});
