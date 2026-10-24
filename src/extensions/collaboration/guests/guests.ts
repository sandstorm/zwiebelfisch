// Guest mode of a room on a collaboration server. See collaboration in ../collaboration.ts.
import { Disposable } from '../../../core/disposable/disposable';
import type { ExtensionContext } from '../../../hosts/extension-host/extension-host';
import { serverHttpBase, type Account } from '../account';
import { DEFAULT_GUEST_DAYS, GUEST_LIFETIMES, GUESTS_CHANGED, type Share } from '../room-protocol';
import css from './guests.css?inline';
import { guestLink, joinWithLink, takeGuestToken } from './guest-link';
import { Shares } from './shares';
import { guestPermissions } from './window/guest-files';
import { endDate, GuestView, ShareButton } from './window/guest-mode';

/**
 * Guest mode of a room on a collaboration server that has guest links (`ZWF_GUESTS`):
 * - a page opened from a guest link (`#zwf-guest=<secret>`) takes the secret out of the URL at once, asks the guest's
 *   name and signs them in as a guest before the room is joined (`beforeConnect`); someone signed in already is told
 *   they need no link
 * - in a GitLab room, the files a guest may not change are Readonly to them (`restrictFiles`, the server's list)
 * - a guest sees that they are one, all the time: the title bar tinted in the warning color with "Guest access · until
 *   Oct 25, 18:00" (red in the last hour; who shared in its tooltip), a warning-coloured frame; once access ends, it
 *   says so
 * - a member who may share sees "Share" at the right of the title bar ("Shared · N guests" while the room has links): a
 *   click opens the menu `guests/share` below it: "New guest link…", then "Revoke “ACME” (until Oct 30, 18:00 · 1
 *   online)…" per link of this project, whoever made it (revoked once confirmed on a modal card); guests' carets are
 *   dashed, their names end in "(guest)"
 * - the commands `collaboration.shareWithGuests` (whom for, how long, then the link: copied, and shown this once) and
 *   `collaboration.manageGuests` (the menu `guests/share`, below "Share")
 *
 * What the server says changed (`guests:changed`, `receive`) is asked for again.
 */
export class Guests {
  readonly #shares: Shares;
  readonly #view: Window | null;
  readonly #url: string;
  #token: string | null;
  #mode: Disposable | null = null;
  #ended = false;
  #member = false;
  #show: () => void = () => {};
  /** The member's "Share" (null: not a member, or not known yet). */
  #button: ShareButton | null = null;

  constructor(
    private readonly context: ExtensionContext,
    private readonly account: Account,
    options: { url: string; room: string },
  ) {
    const { window, commands, subscriptions } = context;
    this.#view = window.ownerDocument.defaultView;
    // before any other extension reads the URL (or puts it in its own)
    this.#token = this.#view ? takeGuestToken(this.#view) : null;
    this.#url = options.url;
    this.#shares = new Shares(options.url, options.room);
    subscriptions.push(
      window.registerStyleSheet(css),
      this.#shares,
      this.#shares.onDidChange(() => this.#show()),
      account.onDidChange(() => void this.#follow()),
      commands.registerCommand('collaboration.shareWithGuests', () => this.share()),
      commands.registerCommand('collaboration.manageGuests', () => this.manage()),
      new Disposable(() => this.#mode?.dispose()),
    );
  }

  /** Signs the guest of the page's guest link in (once), before the room is joined; rejects with why not. */
  async beforeConnect(): Promise<void> {
    const token = this.#token;
    this.#token = null;
    if (token) await joinWithLink(token, this.account, this.context.window, this.context.globalState);
  }

  /** A stateless message from the server: the room's links or guests changed, so they are asked for again. */
  receive(payload: string): void {
    if (payload === GUESTS_CHANGED && this.#mode) void this.#shares.refresh();
  }

  /**
   * The user is out of the room (`reason`), or their session ended: for a guest, their access has ended (the title bar
   * says so, and without `reason` they are told to open the link again; true). False for a member: not guest mode's to
   * tell.
   */
  ended(reason?: string): boolean {
    if (!this.#mode || this.#member) return false;
    this.#ended = true;
    this.#show();
    if (!reason) void this.context.window.showErrorMessage('Your guest access ended; open the guest link again.');
    return true;
  }

  /** Makes the files of a type not in `endings` (the room's `guestEditable`) Readonly in the guest's widget. */
  restrictFiles(endings: readonly string[]): void {
    const { project, workspace, subscriptions } = this.context;
    subscriptions.push(workspace.registerFileSystemProvider(guestPermissions(project, endings)));
  }

  /** Asks whom for and how long, makes the link, copies it and shows it this once. */
  async share(): Promise<void> {
    const { window } = this.context;
    if (!this.#member) {
      void window.showErrorMessage('Only signed-in members share this project with guests, on a server with guest links.');
      return;
    }
    const label = await window.showInputBox({
      title: 'Share with guests',
      prompt: 'Whom the link is for. Guests can edit; only members save.',
      placeHolder: 'e.g. ACME reviewers',
      validateInput: (value) => (value.trim() === '' ? 'Name whom the link is for.' : value.trim().length > 80 ? 'At most 80 characters.' : null),
    });
    if (label === undefined) return;
    const lifetimes = [DEFAULT_GUEST_DAYS, ...GUEST_LIFETIMES.filter((days) => days !== DEFAULT_GUEST_DAYS)].map((days) => ({
      label: `${days} ${days === 1 ? 'day' : 'days'}`,
      description: days === DEFAULT_GUEST_DAYS ? 'default' : undefined,
      days,
    }));
    const lifetime = await window.showQuickPick(lifetimes, { title: 'Share with guests', placeHolder: 'How long the link works' });
    if (!lifetime) return;
    let share: Share & { token: string };
    try {
      share = await this.#shares.create(label.trim(), lifetime.days);
    } catch (error) {
      void window.showErrorMessage(`Cannot share: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    const link = guestLink(this.#view?.location.href ?? '', share.token);
    const copied = await copy(this.#view, link);
    await window.showInputBox({
      title: 'Guest link (shown only now)',
      value: link,
      prompt: `${copied ? 'Copied to the clipboard. ' : ''}Anyone with it edits as a guest until ${endDate(share.expiresAt)}.`,
    });
  }

  /** Opens the menu `guests/share` below "Share". */
  manage(): void {
    const { window } = this.context;
    if (!this.#button) {
      void window.showErrorMessage('Only signed-in members manage the guest links of this project.');
      return;
    }
    window.showContextMenu(SHARE_MENU, { anchor: this.#button.element, title: 'Share with guests' });
  }

  /** Revokes `share`, once confirmed. */
  async #revoke(share: Share): Promise<void> {
    const { window } = this.context;
    const confirmed = await window.showWarningMessage(`Revoke the guest link “${share.label}”?`, { modal: true, detail: 'Its guests lose access at once.' }, 'Revoke');
    if (confirmed !== 'Revoke') return;
    try {
      await this.#shares.revoke(share.id!);
      void window.showInformationMessage(`Guest link “${share.label}” revoked.`);
    } catch (error) {
      void window.showErrorMessage(`Cannot revoke: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Once the account knows who is signed in: guest mode for a guest, the sharing UI for a member (on a server with guest links). */
  async #follow(): Promise<void> {
    const identity = this.account.identity;
    if (this.#mode || !identity) return;
    if (this.account.isGuest) {
      this.#mode = this.#guestMode();
    } else {
      this.#mode = new Disposable(() => {}); // taken, while the server is asked
      if (!(await hasGuestLinks(this.#url))) return;
      this.#member = true;
      this.#mode = this.#memberMode();
    }
    void this.#shares.refresh();
  }

  #guestMode(): Disposable {
    const { window } = this.context;
    const view = new GuestView(window.ownerDocument);
    this.#show = () => view.show(this.#shares.shares[0] ?? null, Date.now(), this.#ended);
    this.#show();
    const ticker = setInterval(() => this.#show(), TICK);
    return Disposable.from(window.registerTitleBarItem(view.element, { alignment: 'left', priority: 1000 }), new Disposable(() => clearInterval(ticker)));
  }

  #memberMode(): Disposable {
    const { window, commands } = this.context;
    const button = new ShareButton(window.ownerDocument, () => this.manage());
    let links = new Disposable(() => {});
    this.#button = button;
    this.#show = () => {
      if (this.#button !== button) return;
      button.show(this.#shares.shares);
      links.dispose();
      links = Disposable.from(
        ...this.#shares.shares.flatMap((share) => {
          const command = `collaboration.revokeGuestLink.${share.id}`;
          return [
            commands.registerCommand(command, () => this.#revoke(share)),
            window.registerMenuItem(SHARE_MENU, { command, title: revokeTitle(share), group: '2_links' }),
          ];
        }),
      );
    };
    return Disposable.from(
      window.registerTitleBarItem(button.element, { alignment: 'right', priority: 300 }),
      window.registerMenuItem(SHARE_MENU, { command: 'collaboration.shareWithGuests', title: 'New guest link…', group: '1_new' }),
      new Disposable(() => {
        links.dispose();
        this.#button = null;
      }),
    );
  }
}

/** The menu below the member's "Share": a new link, then one entry per link that revokes it. */
const SHARE_MENU = 'guests/share';

/** "Revoke “ACME reviewers” (until Oct 30, 18:00 · 1 online)…" */
function revokeTitle(share: Share): string {
  return `Revoke “${share.label}” (until ${endDate(share.expiresAt)} · ${share.online?.length ?? 0} online)…`;
}

/** How often the guest's countdown is brought up to date. */
const TICK = 15_000;

/** Whether the server at `url` has guest links (`GET /api/public/info`); false when it cannot be asked. */
async function hasGuestLinks(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${serverHttpBase(url)}/api/public/info`);
    return response.ok && ((await response.json()) as { guests?: unknown }).guests === true;
  } catch {
    return false;
  }
}

/** Puts `text` on the clipboard; false where the browser does not let it. */
async function copy(view: Window | null, text: string): Promise<boolean> {
  try {
    await view?.navigator.clipboard.writeText(text);
    return !!view;
  } catch {
    return false;
  }
}
