// A guest link's page: its secret, and joining with it. See Guests in guests.ts.
import type { Memento } from '../../../hosts/extension-host/extension-host';
import type { WindowApi } from '../../../hosts/window/window';
import type { Account } from '../account';

/** The URL fragment's key a guest link carries its secret under: `<page>#zwf-guest=<secret>`. */
export const GUEST_LINK_KEY = 'zwf-guest';

/** The guest link of `page` with `token`: the page as it is, without its fragment, the secret as the fragment (never sent to a server). */
export function guestLink(page: string, token: string): string {
  return `${page.replace(/#.*$/, '')}#${GUEST_LINK_KEY}=${encodeURIComponent(token)}`;
}

/**
 * Takes the secret out of the page's guest link (`#zwf-guest=…`) at once: it stays in memory only, the fragment
 * (without it) is put back without a history entry. Null when the page is no guest link.
 */
export function takeGuestToken(view: Pick<Window, 'location' | 'history'>): string | null {
  const fragment = view.location.hash.replace(/^#/, '');
  const params = new URLSearchParams(fragment);
  const token = params.get(GUEST_LINK_KEY);
  if (!token) return null;
  params.delete(GUEST_LINK_KEY);
  const rest = params.toString();
  view.history.replaceState(view.history.state, '', `${view.location.pathname}${view.location.search}${rest ? `#${rest}` : ''}`);
  return token;
}

/**
 * Joins with a guest link's secret `token`: asks for the guest's name (offering the one used last, kept in `state`)
 * and signs in as that guest. Someone signed in already (a member) needs no link: they are told so and stay who they
 * are. Rejects when the name is not given or the server refuses the link (its reason).
 */
export async function joinWithLink(token: string, account: Account, window: Pick<WindowApi, 'showInputBox' | 'showInformationMessage'>, state: Memento): Promise<void> {
  const identity = await account.refresh();
  if (identity && !account.isGuest) {
    void window.showInformationMessage(`You are signed in as ${identity.name}; the guest link is not needed.`);
    return;
  }
  const remembered = state.get<unknown>(NAME_KEY);
  const name = await window.showInputBox({
    title: 'Join as a guest',
    prompt: 'Your name, as the others will see it',
    value: typeof remembered === 'string' ? remembered : '',
    validateInput: (value) =>
      value.trim() === '' ? 'Enter your name.' : value.trim().length > 64 ? 'At most 64 characters.' : /[<>]/.test(value) ? 'Without < or >.' : null,
  });
  if (name === undefined) throw new Error('No name given: open the guest link again to join.');
  await account.joinAsGuest(token, name.trim());
  void state.update(NAME_KEY, name.trim());
}

/** Where the guest's name is kept for the next link (`globalState`). */
const NAME_KEY = 'guestName';
