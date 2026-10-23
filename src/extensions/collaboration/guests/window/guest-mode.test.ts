// @vitest-environment jsdom
// Tests for guest-mode.ts.
import { describe, expect, it, vi } from 'vitest';
import { endDate, GuestView, guestTexts, SharedView, sharedTexts, timeLeft } from './guest-mode';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const now = Date.UTC(2026, 9, 23, 10);
const share = { label: 'ACME', sharedBy: 'Ann Muster', createdAt: now, expiresAt: now + 2 * DAY };

describe('guest mode', () => {
  it('counts down: days, hours, minutes', () => {
    expect([timeLeft(7 * DAY - 5000), timeLeft(2 * DAY + HOUR), timeLeft(DAY), timeLeft(5 * HOUR), timeLeft(HOUR + 1), timeLeft(12 * MINUTE - 1), timeLeft(10)]).toEqual([
      '7 days', '2 days', '1 day', '5 hours', '1 hour', '12 min', '1 min',
    ]);
    expect([timeLeft(2 * DAY, true), timeLeft(5 * HOUR, true), timeLeft(12 * MINUTE, true)]).toEqual(['2 d', '5 h', '12 min']);
  });

  it("tells a guest who shared and when their access ends; red in the last hour and once ended", () => {
    expect(guestTexts(share, now)).toEqual({
      banner: `Guest access · shared by Ann Muster · ends in 2 days (${endDate(share.expiresAt)})`,
      badge: 'GUEST · 2 d left',
      urgent: false,
    });
    const lastHour = guestTexts(share, share.expiresAt - 12 * MINUTE);
    expect(lastHour.banner).toMatch(/^Guest access ends in 12 min \(\d\d:\d\d\) · shared by Ann Muster$/);
    expect(lastHour).toMatchObject({ badge: 'GUEST · 12 min left', urgent: true });
    expect(guestTexts(share, share.expiresAt)).toEqual({ banner: 'Guest access has ended.', badge: 'GUEST · ended', urgent: true });
    expect(guestTexts(share, now, true).banner).toBe('Guest access has ended.');
    expect(guestTexts(null, now)).toEqual({ banner: 'Guest access', badge: 'GUEST', urgent: false });
  });

  it("shows the guest's banner and badge, turning red", () => {
    const view = new GuestView(document);
    view.show(share, now);
    expect(view.banner.textContent).toContain('shared by Ann Muster');
    expect(view.banner.classList.contains('zwf-guests--urgent')).toBe(false);
    view.show(share, share.expiresAt - MINUTE);
    expect(view.banner.classList.contains('zwf-guests--urgent')).toBe(true);
    expect(view.badge.classList.contains('zwf-guests--urgent')).toBe(true);
    expect(view.badge.textContent).toBe('GUEST · 1 min left');
  });

  it("tells members how many guests are in, until when the links last", () => {
    expect(sharedTexts([])).toBeNull();
    const later = { ...share, expiresAt: now + 30 * DAY, online: ['Jane (guest)', 'Joe (guest)'] };
    expect(sharedTexts([share, later])).toEqual({ banner: `Shared with guests · 2 online · until ${endDate(later.expiresAt)}`, badge: 'Shared · 2 guests' });
    expect(sharedTexts([{ ...share, online: ['Jane (guest)'] }])?.badge).toBe('Shared · 1 guest');

    const manage = vi.fn();
    const view = new SharedView(document, manage);
    expect(view.show([])).toBe(false);
    expect(view.show([share])).toBe(true);
    expect(view.badge.textContent).toBe('Shared · 0 guests');
    view.banner.querySelector('button')!.click();
    view.badge.click();
    expect(manage).toHaveBeenCalledTimes(2);
  });
});
