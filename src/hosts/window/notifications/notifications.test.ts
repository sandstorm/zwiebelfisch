// @vitest-environment jsdom
// Tests for notifications.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Notifications } from './notifications';

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

function setup() {
  const host = document.body.appendChild(document.createElement('div'));
  const notifications = new Notifications(host);
  const shown = () => [...host.querySelectorAll<HTMLElement>('.zwf-notification')];
  return { notifications, shown };
}

describe('Notifications', () => {
  it('shows information politely (role=status) and closes it by itself after a while', async () => {
    vi.useFakeTimers();
    const { notifications, shown } = setup();
    const done = notifications.show('info', 'Saved version 01234567', []);
    expect(shown()[0].getAttribute('role')).toBe('status');
    expect(shown()[0].textContent).toContain('Saved version 01234567');
    vi.advanceTimersByTime(10_000);
    expect(await done).toBeUndefined();
    expect(shown()).toHaveLength(0);
  });

  it('keeps warnings and errors (role=alert) until closed, and resolves to the item chosen', async () => {
    vi.useFakeTimers();
    const { notifications, shown } = setup();
    const error = notifications.show('error', 'Saving failed', []);
    const warning = notifications.show('warning', 'Delete a.typ?', [{ title: 'Delete' }]);
    vi.advanceTimersByTime(60_000);
    expect(shown().map((element) => element.getAttribute('role'))).toEqual(['alert', 'alert']);
    shown()[1].querySelector<HTMLButtonElement>('.zwf-notification__item')!.click();
    expect(await warning).toEqual({ title: 'Delete' });
    shown()[0].querySelector<HTMLButtonElement>('[aria-label=Close]')!.click();
    expect(await error).toBeUndefined();
    expect(shown()).toHaveLength(0);
  });

  it('shows at most three, closing the oldest', async () => {
    const { notifications, shown } = setup();
    const first = notifications.show('error', 'one', []);
    for (const text of ['two', 'three', 'four']) void notifications.show('error', text, []);
    expect(await first).toBeUndefined();
    expect(shown().map((element) => element.querySelector('.zwf-notification__message')!.textContent)).toEqual(['two', 'three', 'four']);
  });

  it('shows a modal message on a card over the whole widget, detail below, the first item focused; only an item closes it', async () => {
    vi.useFakeTimers();
    const host = document.body.appendChild(document.createElement('div'));
    const notifications = new Notifications(host);
    const chosen = notifications.show('error', 'You are not signed in', ['Sign in'], { modal: true, detail: 'You signed out.' });
    const card = host.querySelector<HTMLElement>('.zwf-editor__modal [role=alertdialog]')!;
    expect(card.getAttribute('aria-modal')).toBe('true');
    expect([card.querySelector('.zwf-modal__message')!.textContent, card.querySelector('.zwf-modal__detail')!.textContent]).toEqual(['You are not signed in', 'You signed out.']);
    expect(card.querySelector('[aria-label=Close]')).toBeNull();
    expect(document.activeElement!.textContent).toBe('Sign in');
    vi.advanceTimersByTime(60_000);
    expect(host.querySelector('.zwf-editor__modal')).not.toBeNull();
    card.querySelector<HTMLButtonElement>('.zwf-modal__item')!.click();
    expect(await chosen).toBe('Sign in');
    expect(host.querySelector('.zwf-editor__modal')).toBeNull();
  });
});
