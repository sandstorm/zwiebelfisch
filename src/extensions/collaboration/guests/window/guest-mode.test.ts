// @vitest-environment jsdom
// Tests for guest-mode.ts.
import { describe, expect, it, vi } from 'vitest';
import { endDate, GuestView, guestText, ShareButton, shareText, timeLeft } from './guest-mode';

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
  });

  it('tells a guest until when their access lasts, who shared in the tooltip; red in the last hour and once ended', () => {
    expect(guestText(share, now)).toEqual({ text: `Guest access · until ${endDate(share.expiresAt)}`, tooltip: 'You are a guest of Ann Muster: you edit, members save.', urgent: false });
    const lastHour = guestText(share, share.expiresAt - 12 * MINUTE);
    expect(lastHour.text).toMatch(/^Guest access · ends in 12 min \(\d\d:\d\d\)$/);
    expect(lastHour.urgent).toBe(true);
    expect(guestText(share, share.expiresAt)).toMatchObject({ text: 'Guest access has ended.', urgent: true });
    expect(guestText(share, now, true).text).toBe('Guest access has ended.');
    expect(guestText(null, now)).toEqual({ text: 'Guest access', tooltip: 'You are a guest: you edit, members save.', urgent: false });
  });

  it("tints the title bar in the warning color, red when urgent", () => {
    const view = new GuestView(document);
    view.show(share, now);
    expect([view.element.textContent, view.element.dataset.background]).toEqual([`Guest access · until ${endDate(share.expiresAt)}`, 'warning']);
    view.show(share, share.expiresAt - MINUTE);
    expect(view.element.dataset.background).toBe('error');
  });

  it('tells members whether the room is shared, how many guests are in, until when the links last', () => {
    expect(shareText([]).text).toBe('Share');
    const later = { ...share, expiresAt: now + 30 * DAY, online: ['Jane (guest)', 'Joe (guest)'] };
    expect(shareText([share, later])).toEqual({
      text: 'Shared · 2 guests',
      tooltip: `Shared with guests until ${endDate(later.expiresAt)}; 2 online. Guests can edit; only members save. Click for a new link or to revoke one.`,
    });
    expect(shareText([{ ...share, online: ['Jane (guest)'] }]).text).toBe('Shared · 1 guest');

    const clicked = vi.fn();
    const button = new ShareButton(document, clicked);
    button.element.click();
    button.show([share]);
    expect(button.element.textContent).toBe('Shared · 0 guests');
    expect(button.element.getAttribute('aria-haspopup')).toBe('menu');
    button.element.click();
    expect(clicked).toHaveBeenCalledTimes(2);
  });
});
