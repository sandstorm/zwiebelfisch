// @vitest-environment jsdom
// Tests for guests.ts over a fake widget and server.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Disposable } from '../../../core/disposable/disposable';
import type { MenuItem } from '../../../hosts/commands/commands';
import type { ExtensionContext } from '../../../hosts/extension-host/extension-host';
import { Account } from '../account';
import { GUESTS_CHANGED } from '../room-protocol';
import { Guests } from './guests';

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

/** The Guests of a fake widget: what they put in its banner band, status bar and menus, and what they ask. */
function widget(answers: { input?: string[]; pick?: number[]; warning?: string } = {}) {
  const banners: HTMLElement[] = [];
  const statusBar: HTMLElement[] = [];
  const menu: MenuItem[] = [];
  const told: string[] = [];
  const asked: unknown[] = [];
  const commands = new Map<string, () => unknown>();
  const inputs = [...(answers.input ?? [])];
  const picks = [...(answers.pick ?? [])];
  const window = {
    ownerDocument: document,
    registerStyleSheet: () => new Disposable(() => {}),
    registerBanner: (element: HTMLElement) => (banners.push(element), new Disposable(() => banners.splice(banners.indexOf(element), 1))),
    registerStatusBarItem: (element: HTMLElement) => (statusBar.push(element), new Disposable(() => statusBar.splice(statusBar.indexOf(element), 1))),
    registerMenuItem: (_menu: string, item: MenuItem) => (menu.push(item), new Disposable(() => menu.splice(menu.indexOf(item), 1))),
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
  return { guests, account, banners, statusBar, menu, told, asked, commands, dispose };
}

describe('Guests', () => {
  it("joins with the page's guest link before connecting, then shows the guest that they are one", async () => {
    history.replaceState(null, '', `/?room=${encodeURIComponent(room)}#zwf-guest=SECRET`);
    const share = { label: 'ACME', sharedBy: 'Ann Muster', createdAt: 0, expiresAt: Date.now() + 2 * DAY + 60_000 };
    const { requests } = server(null, [share]);
    const { guests, banners, statusBar, menu, dispose } = widget({ input: ['Jane'] });
    expect(location.hash).toBe(''); // the secret is out of the URL at once

    await guests.beforeConnect();
    expect(requests).toContain('POST /api/public/guest/join');
    await vi.waitFor(() => expect(banners[0]?.textContent).toMatch(/^Guest access · shared by Ann Muster · ends in 2 days/));
    expect(statusBar[0].textContent).toBe('GUEST · 2 d left');
    expect(menu).toEqual([]); // a guest does not share

    guests.ended('Guest access to this project has ended.');
    expect(banners[0].textContent).toBe('Guest access has ended.');
    dispose();
    expect(banners).toEqual([]);
  });

  it("shows a member the room's guest links while there are any, refetched when the server says they changed", async () => {
    const shares: object[] = [];
    const { requests } = server({ provider: 'gitlab', id: '1', name: 'Ann' }, shares);
    const { guests, account, banners, statusBar, menu, dispose } = widget();
    await guests.beforeConnect();
    await account.refresh();
    await vi.waitFor(() => expect(menu.map((item) => item.command)).toEqual(['collaboration.shareWithGuests']));
    await vi.waitFor(() => expect(requests.filter((r) => r.endsWith('/shares'))).toHaveLength(1));
    expect(banners).toEqual([]);

    shares.push({ id: 's1', label: 'ACME', sharedBy: 'Ann', createdAt: 0, expiresAt: Date.now() + DAY, online: ['Jane (guest)'] });
    guests.receive(GUESTS_CHANGED);
    await vi.waitFor(() => expect(statusBar[0]?.textContent).toBe('Shared · 1 guest'));
    expect(banners[0].textContent).toMatch(/^Shared with guests · 1 online · until .+Manage…$/);
    shares.pop();
    guests.receive('{"type":"gitlab:merged"}');
    guests.receive(GUESTS_CHANGED);
    await vi.waitFor(() => expect(banners).toEqual([]));
    dispose();
  });

  it('shares: whom for, how long (7 days first), then the link shown once', async () => {
    history.replaceState(null, '', `/?room=${encodeURIComponent(room)}#/main.typ:3`);
    server({ provider: 'gitlab', id: '1', name: 'Ann' }, []);
    const { account, commands, menu, asked } = widget({ input: ['ACME reviewers', ''], pick: [0] });
    await account.refresh();
    await vi.waitFor(() => expect(menu).toHaveLength(1));
    await commands.get('collaboration.shareWithGuests')!();
    expect(asked[0]).toMatchObject({ title: 'Share with guests' });
    expect((asked[1] as { items: { label: string }[] }).items.map((item) => item.label)).toEqual(['7 days', '1 day', '30 days']);
    expect(asked[2]).toMatchObject({ title: 'Guest link (shown only now)', value: `${location.origin}/?room=${encodeURIComponent(room)}#zwf-guest=NEWSECRET` });
  });

  it("manages this project's links, whoever made them: picking one revokes it, once confirmed", async () => {
    const { requests } = server({ provider: 'gitlab', id: '1', name: 'Ann' }, [{ id: 's1', label: 'ACME', sharedBy: 'Bob', createdAt: 0, expiresAt: Date.now() + DAY }]);
    const { account, commands, menu, told, asked } = widget({ pick: [1], warning: 'Revoke' });
    await account.refresh();
    await vi.waitFor(() => expect(menu).toHaveLength(1));
    await commands.get('collaboration.manageGuests')!();
    expect(asked[0]).toMatchObject({ title: "This project's guest links", placeHolder: 'Pick a link to revoke it (any member may)' });
    expect(requests).toContain('DELETE /api/rooms/gitlab%3Ademo%2Freport%40main/shares/s1');
    expect(told).toEqual(['warning: Revoke the guest link "ACME"? Its guests lose access at once.', 'info: Guest link "ACME" revoked.']);
  });

  it('offers nothing on a server without guest links', async () => {
    server({ provider: 'gitlab', id: '1', name: 'Ann' }, [], false);
    const { account, commands, menu, told } = widget();
    await account.refresh();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(menu).toEqual([]);
    await commands.get('collaboration.shareWithGuests')!();
    expect(told[0]).toMatch(/^error: Only signed-in members share/);
  });
});
