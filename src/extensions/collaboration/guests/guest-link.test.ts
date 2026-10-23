// @vitest-environment jsdom
// Tests for guest-link.ts.
import { describe, expect, it, vi } from 'vitest';
import { Account } from '../account';
import { guestLink, joinWithLink, takeGuestToken } from './guest-link';

/** A page at `url`, its history replacing the URL as the browser does. */
function page(url: string) {
  let location = new URL(url);
  const replaceState = vi.fn((_state: unknown, _title: string, next: string) => void (location = new URL(next, location)));
  return {
    view: { get location() { return location as unknown as Location; }, history: { state: null, replaceState } as unknown as History },
    href: () => location.href,
    replaceState,
  };
}

/** A memento in memory (globalState). */
function memento(values: Record<string, unknown> = {}) {
  return { get: (key: string, fallback?: unknown) => values[key] ?? fallback, update: async (key: string, value: unknown) => void (values[key] = value), values } as never;
}

describe('guest links', () => {
  it('is the page without its fragment, the secret as the fragment', () => {
    expect(guestLink('https://editor.example.org/?room=gitlab%3Ag%2Fr%40main#/main.typ:3', 'ABC 1')).toBe('https://editor.example.org/?room=gitlab%3Ag%2Fr%40main#zwf-guest=ABC%201');
  });

  it('takes the secret out of the URL at once, keeping the rest of it', () => {
    const p = page('https://editor.example.org/?room=r#zwf-guest=SECRET');
    expect(takeGuestToken(p.view)).toBe('SECRET');
    expect(p.href()).toBe('https://editor.example.org/?room=r');
    expect(p.replaceState).toHaveBeenCalledOnce();

    const other = page('https://editor.example.org/?room=r#/main.typ:3');
    expect(takeGuestToken(other.view)).toBeNull();
    expect(other.replaceState).not.toHaveBeenCalled();
  });

  it('asks the guest for their name (the last one offered), joins, and remembers it', async () => {
    const bodies: string[] = [];
    let joined = false;
    const send = vi.fn<typeof fetch>(async (input, init): Promise<Response> => {
      if (String(input).endsWith('/api/public/guest/join')) {
        joined = true;
        bodies.push(init!.body as string);
        return new Response(null, { status: 204 });
      }
      return joined ? new Response(JSON.stringify({ provider: 'guest', id: 's/1', name: 'Jane Doe (guest)' })) : new Response('Not signed in', { status: 401 });
    });
    const account = new Account('ws://127.0.0.1:1234', send);
    const showInputBox = vi.fn(async () => ' Jane Doe ');
    const state = memento({ guestName: 'Jane' });
    await joinWithLink('SECRET', account, { showInputBox, showInformationMessage: vi.fn() }, state);
    expect(showInputBox).toHaveBeenCalledWith(expect.objectContaining({ title: 'Join as a guest', value: 'Jane' }));
    expect(bodies.map((body) => JSON.parse(body))).toEqual([{ token: 'SECRET', name: 'Jane Doe' }]);
    expect(account.identity?.name).toBe('Jane Doe (guest)');
    expect((state as unknown as { values: Record<string, unknown> }).values.guestName).toBe('Jane Doe');
  });

  it('tells a member they need no link, and a guest who gives no name why nothing happens', async () => {
    const member = new Account('ws://127.0.0.1:1234', async () => new Response(JSON.stringify({ provider: 'gitlab', id: '1', name: 'Ann' })));
    const showInformationMessage = vi.fn(async () => undefined);
    const showInputBox = vi.fn(async () => undefined);
    await joinWithLink('SECRET', member, { showInputBox, showInformationMessage }, memento());
    expect(showInformationMessage).toHaveBeenCalledWith('You are signed in as Ann; the guest link is not needed.');
    expect(showInputBox).not.toHaveBeenCalled();

    const nobody = new Account('ws://127.0.0.1:1234', async () => new Response('', { status: 401 }));
    await expect(joinWithLink('SECRET', nobody, { showInputBox, showInformationMessage }, memento())).rejects.toThrow('No name given');
  });
});
