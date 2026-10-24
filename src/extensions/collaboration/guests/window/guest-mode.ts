// What guest mode looks like in the title bar: the guest's access, and the members' "Share". See Guests in ../guests.ts.
import type { Share } from '../../room-protocol';

/**
 * What a guest sees of their access at `now`, and whether it is urgent (the last hour, or ended: red). `share` null:
 * not known yet.
 */
export function guestText(share: Share | null, now: number, ended = false): { text: string; tooltip: string; urgent: boolean } {
  const tooltip = share ? `You are a guest of ${share.sharedBy}: you edit, members save.` : 'You are a guest: you edit, members save.';
  const left = share ? share.expiresAt - now : Infinity;
  if (ended || left <= 0) return { text: 'Guest access has ended.', tooltip, urgent: true };
  if (!share) return { text: 'Guest access', tooltip, urgent: false };
  if (left <= HOUR) return { text: `Guest access · ends in ${timeLeft(left)} (${endTime(share.expiresAt)})`, tooltip, urgent: true };
  return { text: `Guest access · until ${endDate(share.expiresAt)}`, tooltip, urgent: false };
}

/** What a member's "Share" says: "Share" without guest links, else how many guests are in, and until when the links last. */
export function shareText(shares: readonly Share[]): { text: string; tooltip: string } {
  if (shares.length === 0) return { text: 'Share', tooltip: 'Share this project with guests, by a link' };
  const online = shares.reduce((sum, share) => sum + (share.online?.length ?? 0), 0);
  const until = Math.max(...shares.map((share) => share.expiresAt));
  return {
    text: `Shared · ${online} ${online === 1 ? 'guest' : 'guests'}`,
    tooltip: `Shared with guests until ${endDate(until)}; ${online} online. Guests can edit; only members save. Click for this project's guest links.`,
  };
}

/** "7 days", "1 day", "5 hours", "1 hour", "12 min": days and hours rounded (a link made a moment ago for 7 days has 7 left), minutes rounded up. */
export function timeLeft(ms: number): string {
  if (ms >= DAY) {
    const days = Math.round(ms / DAY);
    return `${days} ${days === 1 ? 'day' : 'days'}`;
  }
  if (ms >= HOUR) {
    const hours = Math.round(ms / HOUR);
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
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
 * A guest's access, for the title bar: it tints the bar in the warning color (`data-background`), red in the last hour
 * and once ended; and a warning-coloured frame goes around the widget while it is in it (guests.css).
 */
export class GuestView {
  readonly element: HTMLElement;

  constructor(doc: Document) {
    this.element = doc.createElement('span');
    this.element.className = 'zwf-guests__access';
    this.element.setAttribute('role', 'status');
  }

  /** Shows the access of `share` at `now` (see `guestText`). */
  show(share: Share | null, now: number, ended = false): void {
    const { text, tooltip, urgent } = guestText(share, now, ended);
    this.element.textContent = text;
    this.element.title = tooltip;
    this.element.dataset.background = urgent ? 'error' : 'warning';
  }
}

/** A member's "Share" in the title bar (see `shareText`); a click runs `onClick` with whether there are guest links. */
export class ShareButton {
  readonly element: HTMLButtonElement;
  #any = false;

  constructor(doc: Document, onClick: (any: boolean) => void) {
    this.element = doc.createElement('button');
    this.element.type = 'button';
    this.element.className = 'zwf-guests__share';
    this.element.onclick = () => onClick(this.#any);
    this.show([]);
  }

  /** Shows `shares`. */
  show(shares: readonly Share[]): void {
    const { text, tooltip } = shareText(shares);
    this.#any = shares.length > 0;
    this.element.textContent = text;
    this.element.title = tooltip;
    this.element.classList.toggle('zwf-guests__share--shared', this.#any);
  }
}
