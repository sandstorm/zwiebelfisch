// What guest mode looks like: the banners and status bar badges of guests and of members sharing. See Guests in ../guests.ts.
import type { Share } from '../../room-protocol';

/**
 * What a guest sees of their access while it lasts, at `now`: the banner (who shared, when it ends), the status bar
 * badge, and whether it is urgent (the last hour, or ended: red). `share` null: not known yet.
 */
export function guestTexts(share: Share | null, now: number, ended = false): { banner: string; badge: string; urgent: boolean } {
  const left = share ? share.expiresAt - now : Infinity;
  if (ended || left <= 0) return { banner: 'Guest access has ended.', badge: 'GUEST · ended', urgent: true };
  if (!share) return { banner: 'Guest access', badge: 'GUEST', urgent: false };
  if (left <= HOUR) {
    return { banner: `Guest access ends in ${timeLeft(left)} (${endTime(share.expiresAt)}) · shared by ${share.sharedBy}`, badge: `GUEST · ${timeLeft(left, true)} left`, urgent: true };
  }
  return {
    banner: `Guest access · shared by ${share.sharedBy} · ends in ${timeLeft(left)} (${endDate(share.expiresAt)})`,
    badge: `GUEST · ${timeLeft(left, true)} left`,
    urgent: false,
  };
}

/** What a member sees while the room has guest links: the banner and the status bar badge; null without links. */
export function sharedTexts(shares: readonly Share[]): { banner: string; badge: string } | null {
  if (shares.length === 0) return null;
  const online = shares.reduce((sum, share) => sum + (share.online?.length ?? 0), 0);
  const until = Math.max(...shares.map((share) => share.expiresAt));
  return {
    banner: `Shared with guests · ${online} online · until ${endDate(until)}`,
    badge: `Shared · ${online} ${online === 1 ? 'guest' : 'guests'}`,
  };
}

/**
 * "7 days", "1 day", "5 hours", "1 hour", "12 min" (`short`: "7 d", "5 h", "12 min"): days and hours rounded (a link
 * made a moment ago for 7 days has 7 left), minutes rounded up.
 */
export function timeLeft(ms: number, short = false): string {
  if (ms >= DAY) {
    const days = Math.round(ms / DAY);
    return short ? `${days} d` : `${days} ${days === 1 ? 'day' : 'days'}`;
  }
  if (ms >= HOUR) {
    const hours = Math.round(ms / HOUR);
    return short ? `${hours} h` : `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  }
  return `${Math.max(1, Math.ceil(ms / MINUTE))} min`;
}

/** "Oct 25, 18:00", in the viewer's time zone. */
export function endDate(at: number): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
}

/** "18:00", in the viewer's time zone. */
function endTime(at: number): string {
  return new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * A guest's view of their access: a banner (it cannot be closed) and a status bar badge, warning-coloured, red in the
 * last hour and once ended; and a warning-coloured frame around the widget while the banner is in it (guests.css).
 */
export class GuestView {
  readonly banner: HTMLElement;
  readonly badge: HTMLElement;

  constructor(doc: Document) {
    this.banner = doc.createElement('div');
    this.banner.className = 'zwf-guests__banner zwf-guests__banner--guest';
    this.banner.setAttribute('role', 'status');
    this.badge = doc.createElement('span');
    this.badge.className = 'zwf-guests__badge zwf-guests__badge--guest';
  }

  /** Shows the access of `share` at `now` (see `guestTexts`). */
  show(share: Share | null, now: number, ended = false): void {
    const { banner, badge, urgent } = guestTexts(share, now, ended);
    this.banner.textContent = banner;
    this.badge.textContent = badge;
    this.badge.title = share ? `You are a guest of ${share.sharedBy}: you edit, members save.` : 'You are a guest: you edit, members save.';
    for (const element of [this.banner, this.badge]) element.classList.toggle('zwf-guests--urgent', urgent);
  }
}

/** A member's view of the room's guest links: a thin banner with "Manage…" and a status bar badge, while there are any. */
export class SharedView {
  readonly banner: HTMLElement;
  readonly badge: HTMLButtonElement;
  readonly #text: HTMLElement;

  constructor(doc: Document, manage: () => void) {
    this.banner = doc.createElement('div');
    this.banner.className = 'zwf-guests__banner zwf-guests__banner--shared';
    this.#text = this.banner.appendChild(doc.createElement('span'));
    const button = this.banner.appendChild(doc.createElement('button'));
    button.type = 'button';
    button.className = 'zwf-guests__manage';
    button.textContent = 'Manage…';
    button.onclick = manage;
    this.badge = doc.createElement('button');
    this.badge.type = 'button';
    this.badge.className = 'zwf-guests__badge zwf-guests__badge--shared';
    this.badge.title = "Guests can edit this project; only members save. Click to manage this project's guest links.";
    this.badge.onclick = manage;
  }

  /** Shows `shares`; false when there are none (nothing to show). */
  show(shares: readonly Share[]): boolean {
    const texts = sharedTexts(shares);
    if (!texts) return false;
    this.#text.textContent = texts.banner;
    this.badge.textContent = texts.badge;
    return true;
  }
}
