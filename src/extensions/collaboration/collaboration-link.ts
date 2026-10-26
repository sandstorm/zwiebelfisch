// The eager half of collaboration. See collaboration in collaboration.ts.
import { SignInRequired, type Account } from './account';
import type { CollaborationOptions } from './collaboration';
import type { Collaboration, SharedRoom } from './model/model';
import type { GitLabSourceControl, Tell } from './model/gitlab-source-control';
import type { ProjectPath } from '../../core/paths/paths';
import type { SourceRange } from '../../core/typst-document/typst-document';
import type { Participant, PlacedPresence } from './presence/presence';
import { SIGNED_OUT } from './room-protocol';

/**
 * The widget's side of a Collaboration, which it loads on demand: publishes the local selection on `selectionChanged`
 * and tells the widget where everyone else is. With a server, it connects only as the account's signed-in user (a
 * guest link signs a guest in first: `beforeConnect`); signed out (before connecting, or when the session ends: the
 * connection closes, or the server refuses it with SIGNED_OUT), it asks the widget to offer signing in. When the
 * server refuses the user for another reason while in the room, the widget is told why.
 */
export class CollaborationLink {
  private collaboration: Collaboration | null = null;
  private disposed = false;
  private scheduled = false;
  /**
   * Settles once the project is shared: the collaboration code loaded and, with a server, the room synced (its text
   * is in the project), or once that failed (the user is told why, e.g. the server's reason for refusing the room) or
   * the user must sign in first. Until then, what the editors show may still be replaced.
   */
  readonly ready: Promise<void>;

  /** `account`: the user's account on the server of `options` (null: the host's own Y.Doc, no server). */
  constructor(
    options: CollaborationOptions,
    shared: SharedRoom,
    private readonly widget: LinkedWidget,
    private readonly account: Account | null = null,
  ) {
    this.ready = this.start(options, shared).catch((error: unknown) => {
      if (error instanceof SignInRequired) return this.widget.signInRequired?.();
      const reason = error instanceof Error ? error.message : String(error);
      console.error('collaboration could not start:', error);
      this.widget.tell?.(`Cannot join the room: ${reason}`, 'error');
    });
  }

  dispose(): void {
    this.disposed = true;
    this.collaboration?.dispose();
  }

  private async start(options: CollaborationOptions, shared: SharedRoom): Promise<void> {
    if (this.account) {
      await this.widget.beforeConnect?.();
      const identity = this.account.identity ?? (await this.account.refresh());
      if (!identity) throw new SignInRequired();
      // others see the name the server knows (in GitLab rooms, the GitLab account's)
      shared = { ...shared, user: { ...shared.user, name: identity.name }, guest: this.account.isGuest };
    }
    if (this.disposed) return;
    const { Collaboration } = await import('./model/model');
    const account = this.account;
    const signedIn = account ? async () => !!(await account.refresh()) : undefined;
    const collaboration = await Collaboration.start(options, shared, this.widget.tell, signedIn);
    if (this.disposed) {
      collaboration.dispose();
      return;
    }
    this.collaboration = collaboration;
    this.tellWidget(collaboration, !!shared.guest);
  }

  /** Tells the widget what `collaboration`, joined (as a guest: `guest`), says and has from now on. */
  private tellWidget(collaboration: Collaboration, guest: boolean): void {
    const { widget } = this;
    void collaboration.signedOut.then(() => this.disposed || widget.signInRequired?.(SESSION_ENDED));
    void collaboration.refused.then((reason) => {
      if (this.disposed) return;
      if (reason === SIGNED_OUT) return widget.signInRequired?.(reason);
      widget.tell?.(reason, 'error');
      widget.onRefused?.(reason);
    });
    collaboration.onDidReceiveMessage((payload) => widget.onMessage?.(payload));
    collaboration.onDidChangePresence((presences) => widget.onPresence?.(presences));
    collaboration.onDidChangeParticipants((participants) => widget.onParticipants?.(participants));
    if (collaboration.sourceControl) widget.onSourceControl?.(collaboration.sourceControl);
    if (guest && collaboration.guestEditable) widget.onGuestEditable?.(collaboration.guestEditable);
  }

  /** Asks for the files from outside the room's folder that the compiler misses (see `Collaboration.pull`); before joining, nothing. */
  pull(paths: readonly ProjectPath[]): void {
    if (paths.length > 0) this.collaboration?.pull(paths);
  }

  /** Whether the branch has the file `path` from outside the room's folder (see `Collaboration.onBranch`); before joining, false. */
  onBranch(path: ProjectPath): boolean {
    return this.collaboration?.onBranch(path) ?? false;
  }

  /** Whether leaving now would leave changes behind that nobody commits (see `Collaboration.leavesChangesUncommitted`). */
  leavesChangesUncommitted(): boolean {
    return this.collaboration?.leavesChangesUncommitted ?? false;
  }

  /**
   * The local selection moved (called by the editors after their state
   * has the new selection). Publishes it once per burst, when the user works
   * in this widget.
   */
  selectionChanged(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      if (!this.collaboration || !this.widget.focused()) return;
      const current = this.widget.current();
      this.collaboration.setCursor(current?.path ?? null, current?.selection);
    });
  }
}

/** The file the local user works in, and what they have selected there. */
export interface CurrentSelection {
  path: ProjectPath;
  selection: SourceRange;
}

/** What the link asks of the widget, and tells it. */
export interface LinkedWidget {
  /** Where the local user's selection is (null: not in a Typst file). */
  current(): CurrentSelection | null;
  /** Whether the user works in the widget's editing area (only then is the selection published). */
  focused(): boolean;
  /** Called once connected, in a room backed by a GitLab branch: what commits to it. */
  onSourceControl?(sourceControl: GitLabSourceControl): void;
  /** Called once connected as a guest, in a room backed by a GitLab branch: the endings of the files a guest may change (`guestMayChange`). */
  onGuestEditable?(endings: readonly string[]): void;
  /** Tells the user what the room's source control has to say (its outcomes and news). */
  tell?: Tell;
  /**
   * The server lets only signed-in users join, and the user is not signed in: before joining (`reason` undefined), or
   * no longer (`reason`: why, e.g. the server's "You signed out.").
   */
  signInRequired?(reason?: string): void;
  /** The other users' places changed (every file; e.g. for the file panel). */
  onPresence?(presences: readonly PlacedPresence[]): void;
  /** Someone came into the room or left it (every other user, with a caret in a file or not). */
  onParticipants?(participants: readonly Participant[]): void;
  /** Runs before the account is asked who is signed in (a guest link signs its guest in here); a rejection is told. */
  beforeConnect?(): Promise<void>;
  /** A stateless message from the server (e.g. that the room's guests changed). */
  onMessage?(payload: string): void;
  /** The server refused the user while in the room, for `reason` (after it was told): they are out of it now. */
  onRefused?(reason: string): void;
}

/** Why the user must sign in again when the connection closed because the session is gone. */
const SESSION_ENDED = 'Your session ended.';
