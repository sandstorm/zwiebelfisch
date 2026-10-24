// Guest mode of a room on a collaboration server. See collaboration in ../collaboration.ts.
import { Disposable } from '../../../core/disposable/disposable';
import type { ExtensionContext } from '../../../hosts/extension-host/extension-host';
import type { QuickPickItem } from '../../../hosts/window/window';
import { serverHttpBase, type Account } from '../account';
import { DEFAULT_GUEST_DAYS, GUEST_LIFETIMES, GUESTS_CHANGED, type Share } from '../room-protocol';
import css from './guests.css?inline';
import { guestLink, joinWithLink, takeGuestToken } from './guest-link';
import { Shares } from './shares';
import { guestPermissions } from './window/guest-files';
import { endDate, GuestView, SharedView } from './window/guest-mode';

/**
 * Guest mode of a room on a collaboration server that has guest links (`ZWF_GUESTS`):
 * - a page opened from a guest link (`#zwf-guest=<secret>`) takes the secret out of the URL at once, asks the guest's
 *   name and signs them in as a guest before the room is joined (`beforeConnect`); someone signed in already is told
 *   they need no link
 * - in a GitLab room, the files a guest may not change are Readonly to them (`restrictFiles`, the server's list)
 * - a guest sees that they are one, all the time: a banner that cannot be closed (who shared, when access ends; red in
 *   the last hour), a "GUEST · 2 d left" badge, a warning-coloured frame; once access ends, the banner says so
 * - a member who may share sees, while the room has links, a banner ("Shared with guests · N online · until …",
 *   "Manage…") and a "Shared · N guests" badge; guests' carets are dashed, their names end in "(guest)"
 * - the commands `collaboration.shareWithGuests` (whom for, how long, then the link: copied, and shown this once) and
 *   `collaboration.manageGuests` (this project's links, whoever made them; picking one revokes it)
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
   * The user is out of the room (`reason`), or their session ended: for a guest, their access has ended (the banner
   * says so, and they are told to open the link again; true). False for a member: not guest mode's to tell.
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

  /** Lists the links (and "New guest link…"); picking one revokes it, once confirmed. */
  async manage(): Promise<void> {
    const { window } = this.context;
    if (!this.#member) {
      void window.showErrorMessage('Only signed-in members manage the guest links of this project.');
      return;
    }
    await this.#shares.refresh();
    type Item = QuickPickItem & { share?: Share };
    const items: Item[] = [
      { label: 'New guest link…' },
      ...this.#shares.shares.map((share) => ({
        label: share.label,
        description: `by ${share.sharedBy} · until ${endDate(share.expiresAt)} · ${share.online?.length ?? 0} online`,
        detail: share.online?.length ? share.online.join(', ') : undefined,
        share,
      })),
    ];
    const picked = await window.showQuickPick(items, { title: "This project's guest links", placeHolder: 'Pick a link to revoke it (any member may)' });
    if (!picked) return;
    if (!picked.share) return this.share();
    const { share } = picked;
    if ((await window.showWarningMessage(`Revoke the guest link "${share.label}"? Its guests lose access at once.`, 'Revoke')) !== 'Revoke') return;
    try {
      await this.#shares.revoke(share.id!);
      void window.showInformationMessage(`Guest link "${share.label}" revoked.`);
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
    return Disposable.from(
      window.registerBanner(view.banner),
      window.registerStatusBarItem(view.badge, { alignment: 'left', priority: 1000 }),
      new Disposable(() => clearInterval(ticker)),
    );
  }

  #memberMode(): Disposable {
    const { window, commands } = this.context;
    const view = new SharedView(window.ownerDocument, () => void commands.executeCommand('collaboration.manageGuests'));
    let shown: Disposable | null = null;
    this.#show = () => {
      const any = view.show(this.#shares.shares);
      if (any && !shown) shown = Disposable.from(window.registerBanner(view.banner), window.registerStatusBarItem(view.badge, { alignment: 'left', priority: 1000 }));
      if (!any && shown) {
        shown.dispose();
        shown = null;
      }
    };
    return Disposable.from(
      window.registerMenuItem('window/editorTitle', { command: 'collaboration.shareWithGuests', group: 'sourceControl', order: 10 }),
      new Disposable(() => shown?.dispose()),
    );
  }
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
