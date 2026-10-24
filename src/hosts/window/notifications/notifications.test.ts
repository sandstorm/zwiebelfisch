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
    shown()[0].querySelector<HTMLButtonElement>('.zwf-notification__item')!.click();
    expect(await warning).toEqual({ title: 'Delete' });
    shown()[0].querySelector<HTMLButtonElement>('[aria-label=Close]')!.click();
    expect(await error).toBeUndefined();
    expect(shown()).toHaveLength(0);
  });

  it('shows at most three, newest on top, closing the oldest', async () => {
    const { notifications, shown } = setup();
    const first = notifications.show('error', 'one', []);
    for (const text of ['two', 'three', 'four']) void notifications.show('error', text, []);
    expect(await first).toBeUndefined();
    expect(shown().map((element) => element.querySelector('.zwf-notification__message')!.textContent)).toEqual(['four', 'three', 'two']);
  });

  it('keeps information with the pointer on it, and closes it a while after the pointer left', () => {
    vi.useFakeTimers();
    const { notifications, shown } = setup();
    void notifications.show('info', 'Saved', []);
    shown()[0].dispatchEvent(new Event('pointerenter'));
    vi.advanceTimersByTime(60_000);
    expect(shown()).toHaveLength(1);
    shown()[0].dispatchEvent(new Event('pointerleave'));
    vi.advanceTimersByTime(10_000);
    expect(shown()).toHaveLength(0);
  });

  it('shows a modal message on a card over the whole widget, detail below, Cancel after the items, the first item focused, the rest inert', async () => {
    vi.useFakeTimers();
    const host = document.body.appendChild(document.createElement('div'));
    const editing = host.appendChild(document.createElement('div'));
    const notifications = new Notifications(host);
    const chosen = notifications.show('error', 'You are not signed in', ['Sign in'], { modal: true, detail: 'You signed out.' });
    expect(editing.hasAttribute('inert')).toBe(true);
    const card = host.querySelector<HTMLElement>('.zwf-editor__modal [role=alertdialog]')!;
    expect(card.getAttribute('aria-modal')).toBe('true');
    expect([card.querySelector('.zwf-modal__message')!.textContent, card.querySelector('.zwf-modal__detail')!.textContent]).toEqual(['You are not signed in', 'You signed out.']);
    expect(card.querySelector('[aria-label=Close]')).toBeNull();
    expect([...card.querySelectorAll('button')].map((button) => button.textContent)).toEqual(['Sign in', 'Cancel']);
    expect(document.activeElement!.textContent).toBe('Sign in');
    vi.advanceTimersByTime(60_000);
    expect(host.querySelector('.zwf-editor__modal')).not.toBeNull();
    card.querySelector<HTMLButtonElement>('.zwf-modal__item')!.click();
    expect(await chosen).toBe('Sign in');
    expect(host.querySelector('.zwf-editor__modal')).toBeNull();
    expect(editing.hasAttribute('inert')).toBe(false);
  });

  it('closes a modal message on Cancel or Escape, resolving to undefined, the focus back where it was', async () => {
    const host = document.body.appendChild(document.createElement('div'));
    const editing = host.appendChild(document.createElement('div'));
    const row = editing.appendChild(document.createElement('button'));
    row.focus();
    const notifications = new Notifications(host);
    const cancelled = notifications.show('warning', 'Delete a.typ?', ['Delete'], { modal: true });
    host.querySelector<HTMLButtonElement>('.zwf-modal__cancel')!.click();
    expect(await cancelled).toBeUndefined();
    expect(editing.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(row); // the focus is back
    const escaped = notifications.show('warning', 'Delete a.typ?', ['Delete'], { modal: true });
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(await escaped).toBeUndefined();
    expect(host.querySelector('.zwf-editor__modal')).toBeNull();
  });
});
