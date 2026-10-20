// @vitest-environment jsdom
// Tests for account.ts.
import { describe, expect, it, vi } from 'vitest';
import { Account } from '../account';
import { AccountStatus } from './account';

function setup(me: object | null) {
  const account = new Account('ws://127.0.0.1:1234', async () =>
    me ? new Response(JSON.stringify(me)) : new Response('Not signed in', { status: 401 }),
  );
  const actions = { signIn: vi.fn(), showMenu: vi.fn() };
  const status = new AccountStatus(document, account, actions);
  account.onDidChange(() => status.show());
  return { account, actions, element: status.element };
}

describe('AccountStatus', () => {
  it('shows nothing until the server answered', () => {
    expect(setup(null).element.hidden).toBe(true);
  });

  it('signed out: "Sign in", which signs in', async () => {
    const { account, actions, element } = setup(null);
    await account.refresh();
    expect(element.hidden).toBe(false);
    expect(element.textContent).toBe('Sign in');
    element.click();
    expect(actions.signIn).toHaveBeenCalledOnce();
    expect(actions.showMenu).not.toHaveBeenCalled();
  });

  it('signed in: the name, whose click opens the account menu there', async () => {
    const { account, actions, element } = setup({ provider: 'gitlab', id: '2', name: 'Ann', email: 'ann@gitlab.test' });
    await account.refresh();
    expect(element.textContent).toBe('Ann');
    expect(element.title).toBe('Signed in as Ann (ann@gitlab.test)');
    element.click();
    expect(actions.showMenu).toHaveBeenCalledWith(element);
    expect(actions.signIn).not.toHaveBeenCalled();
  });
});
