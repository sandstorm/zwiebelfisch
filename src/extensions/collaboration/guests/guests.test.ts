// @vitest-environment jsdom
// Tests for guests.ts over a fake widget and server.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Disposable } from '../../../core/disposable/disposable';
import type { ExtensionContext } from '../../../hosts/extension-host/extension-host';
import { Account } from '../account';
import { GUESTS_CHANGED } from '../room-protocol';
import { Guests } from './guests';
import { endDate } from './window/guest-mode';

const DAY = 24 * 60 * 60 * 1000;
const room = 'gitlab:demo/report@main';

afterEach(() => {
  vi.unstubAllGlobals();
  history.replaceState(null, '', '/');
});

/** A server: who is signed in (`me`, null: nobody), its guest links (`shares`), and guest links on (`guests`). */
function server(me: { provider: string; id: string; name: string } | null, shares: object[], guests = true) {
  const requests: string[] = [];
  const routes: Record<string, (init?: RequestInit) => Response> = {
    'GET /api/public/info': () => new Response(JSON.stringify({ plainRooms: false, guests })),
    'GET /api/me': () => (me ? new Response(JSON.stringify(me)) : new Response('', { status: 401 })),
    'POST /api/public/guest/join': (init) => {
      me = { provider: 'guest', id: 's1/x', name: `${JSON.parse(init!.body as string).name} (guest)` };
      return new Response(null, { status: 204 });
    },
    'GET /shares': () => new Response(JSON.stringify({ shares })),
    'POST /shares': () => new Response(JSON.stringify({ id: 's2', label: 'ACME', sharedBy: 'Ann', createdAt: 0, expiresAt: Date.now() + 7 * DAY, token: 'NEWSECRET' }), { status: 201 }),
    'DELETE /shares': () => new Response(null, { status: 204 }),
  };
  const send = vi.fn<typeof fetch>(async (input, init) => {
    const request = `${init?.method ?? 'GET'} ${String(input).replace('http://127.0.0.1:1234', '')}`;
    requests.push(request);
    const route = Object.keys(routes).find((key) => request === key || (key.endsWith('/shares') && request.startsWith(key.split(' ')[0]) && request.includes('/shares')));
    return route ? routes[route](init) : new Response('', { status: 404 });
  });
  vi.stubGlobal('fetch', send);
  return { send, requests };
}

/** The Guests of a fake widget: what they put in its title bar, and what they ask. */
function widget(answers: { input?: string[]; pick?: number[]; warning?: string } = {}) {
  const titleBar: { element: HTMLElement; alignment: string }[] = [];
  const told: string[] = [];
  const asked: unknown[] = [];
  const commands = new Map<string, () => unknown>();
  const inputs = [...(answers.input ?? [])];
  const picks = [...(answers.pick ?? [])];
  const window = {
    ownerDocument: document,
    registerStyleSheet: () => new Disposable(() => {}),
    registerTitleBarItem: (element: HTMLElement, { alignment }: { alignment: string }) => {
      const item = { element, alignment };
      titleBar.push(item);
      return new Disposable(() => titleBar.splice(titleBar.indexOf(item), 1));
    },
    showInputBox: async (options: unknown) => (asked.push(options), inputs.shift()),
    showQuickPick: async (items: readonly unknown[], options: unknown) => (asked.push({ items, ...(options as object) }), items[picks.shift() ?? -1]),
    showInformationMessage: async (message: string) => void told.push(`info: ${message}`),
    showWarningMessage: async (message: string) => (told.push(`warning: ${message}`), answers.warning),
    showErrorMessage: async (message: string) => void told.push(`error: ${message}`),
  };
  const values: Record<string, unknown> = {};
  const globalState = { get: (key: string, fallback?: unknown) => values[key] ?? fallback, update: async (key: string, value: unknown) => void (values[key] = value) };
  const subscriptions: { dispose(): unknown }[] = [];
  const context = {
    window,
    globalState,
    subscriptions,
    commands: {
      registerCommand: (id: string, handler: () => unknown) => (commands.set(id, handler), new Disposable(() => commands.delete(id))),
      executeCommand: (id: string) => commands.get(id)?.(),
    },
  } as unknown as ExtensionContext;
  const account = new Account('ws://127.0.0.1:1234');
  const guests = new Guests(context, account, { url: 'ws://127.0.0.1:1234', room });
  const dispose = () => subscriptions.reverse().forEach((each) => each.dispose());
  /** The text of the guest's access (left), of the member's "Share" (right). */
  const access = () => titleBar.filter((item) => item.alignment === 'left').map((item) => item.element.textContent);
  const share = () => titleBar.filter((item) => item.alignment === 'right').map((item) => item.element as HTMLButtonElement);
  return { guests, account, titleBar, access, share, told, asked, commands, dispose };
}

describe('Guests', () => {
  it("joins with the page's guest link before connecting, then shows the guest that they are one", async () => {
    history.replaceState(null, '', `/?room=${encodeURIComponent(room)}#zwf-guest=SECRET`);
    const share = { label: 'ACME', sharedBy: 'Ann Muster', createdAt: 0, expiresAt: Date.now() + 2 * DAY + 60_000 };
    const { requests } = server(null, [share]);
    const { guests, titleBar, access, share: shareButton, told, dispose } = widget({ input: ['Jane'] });
    expect(location.hash).toBe(''); // the secret is out of the URL at once

    await guests.beforeConnect();
    expect(requests).toContain('POST /api/public/guest/join');
    await vi.waitFor(() => expect(access()).toEqual([`Guest access · until ${endDate(share.expiresAt)}`]));
    expect(titleBar[0].element.dataset.background).toBe('warning');
    expect(shareButton()).toEqual([]); // a guest does not share

    expect(guests.ended('Guest access to this project has ended.')).toBe(true);
    expect(access()).toEqual(['Guest access has ended.']);
    expect(titleBar[0].element.dataset.background).toBe('error');
    expect(told).toEqual([]); // the reason was told already
    guests.ended();
    expect(told).toEqual(['error: Your guest access ended; open the guest link again.']);
    dispose();
    expect(titleBar).toEqual([]);
  });

  it("shows a member the room's guest links while there are any, refetched when the server says they changed", async () => {
    const shares: object[] = [];
    const { requests } = server({ provider: 'gitlab', id: '1', name: 'Ann' }, shares);
    const { guests, account, access, share, asked, dispose } = widget();
    await guests.beforeConnect();
    await account.refresh();
    await vi.waitFor(() => expect(share().map((button) => button.textContent)).toEqual(['Share']));
    await vi.waitFor(() => expect(requests.filter((r) => r.endsWith('/shares'))).toHaveLength(1));
    expect(access()).toEqual([]);
    share()[0].click();
    await vi.waitFor(() => expect(asked[0]).toMatchObject({ title: 'Share with guests' })); // no links yet: shares

    shares.push({ id: 's1', label: 'ACME', sharedBy: 'Ann', createdAt: 0, expiresAt: Date.now() + DAY, online: ['Jane (guest)'] });
    guests.receive(GUESTS_CHANGED);
    await vi.waitFor(() => expect(share()[0].textContent).toBe('Shared · 1 guest'));
    share()[0].click();
    await vi.waitFor(() => expect(asked[1]).toMatchObject({ title: "This project's guest links" })); // with links: lists them
    shares.pop();
    guests.receive('{"type":"gitlab:merged"}');
    guests.receive(GUESTS_CHANGED);
    await vi.waitFor(() => expect(share()[0].textContent).toBe('Share'));
    dispose();
  });

  it('shares: whom for, how long (7 days first), then the link shown once', async () => {
    history.replaceState(null, '', `/?room=${encodeURIComponent(room)}#/main.typ:3`);
    server({ provider: 'gitlab', id: '1', name: 'Ann' }, []);
    const { account, commands, share, asked } = widget({ input: ['ACME reviewers', ''], pick: [0] });
    await account.refresh();
    await vi.waitFor(() => expect(share()).toHaveLength(1));
    await commands.get('collaboration.shareWithGuests')!();
    expect(asked[0]).toMatchObject({ title: 'Share with guests' });
    expect((asked[1] as { items: { label: string }[] }).items.map((item) => item.label)).toEqual(['7 days', '1 day', '30 days']);
    expect(asked[2]).toMatchObject({ title: 'Guest link (shown only now)', value: `${location.origin}/?room=${encodeURIComponent(room)}#zwf-guest=NEWSECRET` });
  });

  it("manages this project's links, whoever made them: picking one revokes it, once confirmed", async () => {
    const { requests } = server({ provider: 'gitlab', id: '1', name: 'Ann' }, [{ id: 's1', label: 'ACME', sharedBy: 'Bob', createdAt: 0, expiresAt: Date.now() + DAY }]);
    const { account, commands, share, told, asked } = widget({ pick: [1], warning: 'Revoke' });
    await account.refresh();
    await vi.waitFor(() => expect(share()).toHaveLength(1));
    await commands.get('collaboration.manageGuests')!();
    expect(asked[0]).toMatchObject({ title: "This project's guest links", placeHolder: 'Pick a link to revoke it (any member may)' });
    expect(requests).toContain('DELETE /api/rooms/gitlab%3Ademo%2Freport%40main/shares/s1');
    expect(told).toEqual(['warning: Revoke the guest link "ACME"? Its guests lose access at once.', 'info: Guest link "ACME" revoked.']);
  });

  it('offers nothing on a server without guest links', async () => {
    server({ provider: 'gitlab', id: '1', name: 'Ann' }, [], false);
    const { account, commands, share, told } = widget();
    await account.refresh();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(share()).toEqual([]);
    await commands.get('collaboration.shareWithGuests')!();
    expect(told[0]).toMatch(/^error: Only signed-in members share/);
  });
});
