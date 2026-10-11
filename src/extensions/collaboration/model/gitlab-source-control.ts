// GitLabSourceControl: the GitLab branch behind a room as a source control (`scm.registerSourceControl`):
// commit asks the server to commit over stateless messages; the server's answers and news are told as messages; what
// the room has that the branch has not (the server's `meta.changes`) are its resource states and status bar entry.
// See model.ts.
import type * as Y from 'yjs';
import type { Disposable } from '../../../core/disposable/disposable';
import { EventEmitter, type Event } from '../../../core/event-emitter/event-emitter';
import { ProjectPath } from '../../../core/paths/paths';
import { DEFAULT_COMMIT_MESSAGE, META_MAP, type ChangedFile, type ClientMessage, type RoomChanges, type ServerMessage } from '../../../core/room-protocol/room-protocol';

/** Stateless messages to and from the server (the Hocuspocus provider's). */
export interface StatelessChannel {
  send(payload: string): void;
  /** Fires with every message from the server. */
  readonly onDidReceiveMessage: Event<string>;
}

/** Tells the user something, as a message of `severity` (the window's messages). */
export type Tell = (message: string, severity: 'info' | 'warning' | 'error') => void;

/** A file with changes not in GitLab, and its badge in the file panel (the scm host's `SourceControlResourceState`). */
export interface ResourceState {
  readonly path: ProjectPath;
  readonly decorations: { readonly badge: string; readonly tooltip: string; readonly color: string };
}

/** The status bar entry (the scm host's `SourceControlStatusBarCommand`). */
export interface StatusBarCommand {
  readonly title: string;
  readonly tooltip: string;
}

/** How often the status bar entry's age ("14 min") is brought up to date. */
const MINUTE = 60_000;

/**
 * The commits of a room backed by a GitLab branch, as a client sees them: `commit` asks the server to commit the
 * room's changes as `author` (`state.busy` until it answers); the server's answers (saved, nothing to save, a
 * conflict, a failure) and its news (upstream changes merged) are told with `tell`. What the room has that the branch
 * has not (written by the server into the room's meta map) is shown as resource states (M / A / D) and in the status
 * bar ("Not in GitLab: 3 files · 14 min (Ann, Bob)", or "Saved · 01234567"). Shaped as the scm host's `SourceControl`.
 */
export class GitLabSourceControl {
  readonly id = 'gitlab';
  readonly label = 'GitLab';
  readonly defaultCommitMessage = DEFAULT_COMMIT_MESSAGE;
  #state: CommitState = { busy: false };
  #resourceStates: readonly ResourceState[] = [];
  readonly #changed = new EventEmitter<void>();
  readonly onDidChange = this.#changed.event;
  readonly #subscription: Disposable;
  readonly #meta: Y.Map<unknown>;
  /** Fires `onDidChange` every minute while there are changes, for their age. */
  #ticker: ReturnType<typeof setInterval> | undefined;

  constructor(
    ydoc: Y.Doc,
    private readonly channel: StatelessChannel,
    private readonly tell: Tell,
    private readonly author?: { name: string },
  ) {
    this.#meta = ydoc.getMap(META_MAP);
    this.#meta.observe(this.#metaChanged);
    this.#follow();
    this.#subscription = channel.onDidReceiveMessage((payload) => {
      const message = parse(payload);
      if (message) this.#receive(message);
    });
  }

  /** Whether `ydoc` is the Y.Doc of a GitLab-backed room (its server put the last commit's sha there). */
  static isGitLabRoom(ydoc: Y.Doc): boolean {
    return typeof ydoc.getMap(META_MAP).get('baseSha') === 'string';
  }

  get state(): CommitState {
    return this.#state;
  }

  /** The files with changes not in GitLab, badged M (modified), A (added) or D (deleted). */
  get resourceStates(): readonly ResourceState[] {
    return this.#resourceStates;
  }

  /** "Not in GitLab: 3 files · 14 min (Ann, Bob)" while the room has changes, else "Saved · <commit>". */
  get statusBarCommands(): readonly StatusBarCommand[] {
    const changes = this.#changes();
    if (changes) return [{ title: notInGitLab(changes, Date.now()), tooltip: changesTooltip(changes) }];
    const sha = this.#meta.get('baseSha');
    if (typeof sha !== 'string') return [];
    return [{ title: `Saved · ${sha.slice(0, 8)}`, tooltip: `Everything is in GitLab (commit ${sha.slice(0, 8)}). Click to save.` }];
  }

  commit(message: string): void {
    const request: ClientMessage = { type: 'gitlab:save', message, ...(this.author ? { author: this.author } : {}) };
    this.#set({ busy: true });
    this.channel.send(JSON.stringify(request));
  }

  dispose(): void {
    this.#meta.unobserve(this.#metaChanged);
    clearInterval(this.#ticker);
    this.#subscription.dispose();
    this.#changed.dispose();
  }

  readonly #metaChanged = (): void => {
    this.#follow();
    this.#changed.fire();
  };

  /** Takes in the room's changes: the resource states, and the ticker while there are any. */
  #follow(): void {
    const changes = this.#changes();
    this.#resourceStates = (changes?.files ?? []).flatMap((file) => {
      const path = ProjectPath.parse(file.path);
      return path ? [{ path, decorations: DECORATIONS[file.kind] }] : [];
    });
    if (changes && this.#ticker === undefined) this.#ticker = setInterval(() => this.#changed.fire(), MINUTE);
    if (!changes && this.#ticker !== undefined) {
      clearInterval(this.#ticker);
      this.#ticker = undefined;
    }
  }

  /** `meta.changes`, as the server wrote it (checked: it comes over the wire). */
  #changes(): RoomChanges | null {
    const changes = this.#meta.get('changes') as Partial<RoomChanges> | null | undefined;
    if (!changes || !Array.isArray(changes.files) || typeof changes.since !== 'number' || !Array.isArray(changes.editors)) return null;
    const files = changes.files.filter((file) => typeof file?.path === 'string' && Object.hasOwn(DECORATIONS, file.kind));
    return files.length ? { files, since: changes.since, editors: changes.editors.filter((name) => typeof name === 'string') } : null;
  }

  #receive(message: ServerMessage): void {
    const { text, severity } = said(message);
    this.tell(text, severity);
    // upstream changes are news, not the answer to a commit under way
    if (message.type !== 'gitlab:merged') this.#set({ busy: false });
  }

  #set(state: CommitState): void {
    this.#state = state;
    this.#changed.fire();
  }
}

/** The badges of changed files, as VS Code's explorer shows them. */
const DECORATIONS: Record<ChangedFile['kind'], ResourceState['decorations']> = {
  modified: { badge: 'M', tooltip: 'Changed, not in GitLab yet', color: '#b58900' },
  added: { badge: 'A', tooltip: 'New, not in GitLab yet', color: '#859900' },
  deleted: { badge: 'D', tooltip: 'Deleted, not in GitLab yet', color: '#dc322f' },
};

/** "Not in GitLab: 3 files · 14 min (Ann, Bob)": how many files, for how long (at `now`), by whom. */
function notInGitLab(changes: RoomChanges, now: number): string {
  const count = changes.files.length;
  const by = changes.editors.length ? ` (${changes.editors.join(', ')})` : '';
  return `Not in GitLab: ${count} ${count === 1 ? 'file' : 'files'} · ${age(now - changes.since)}${by}`;
}

/** "< 1 min", "14 min", "2 h", "2 h 5 min". */
function age(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / MINUTE));
  if (minutes < 1) return '< 1 min';
  if (minutes < 60) return `${minutes} min`;
  return minutes % 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes / 60} h`;
}

/** The changed files, one per line with its badge, and what a click does. */
function changesTooltip(changes: RoomChanges): string {
  const lines = changes.files.map((file) => `${DECORATIONS[file.kind].badge} ${file.path.slice(1)}`);
  return ['Not in GitLab yet:', ...lines, 'Click to save.'].join('\n');
}

/** Whether a commit is under way (the scm host's `SourceControlState`). */
export interface CommitState {
  readonly busy: boolean;
}

/** What to tell for `message`: the saved version, nothing to save, merged upstream changes, a conflict, a failure. */
function said(message: ServerMessage): { text: string; severity: Parameters<Tell>[1] } {
  switch (message.type) {
    case 'gitlab:saved':
      return { text: `Saved version ${message.sha.slice(0, 8)} (${message.author})`, severity: 'info' };
    case 'gitlab:unchanged':
      return { text: 'No changes to save', severity: 'info' };
    case 'gitlab:merged':
      return { text: 'Merged new changes from GitLab', severity: 'info' };
    case 'gitlab:conflict':
      return { text: `Changes on GitLab conflict with edits in ${message.files.map((file) => file.path).join(', ')}; not saved`, severity: 'warning' };
    case 'gitlab:error':
      return { text: `Saving failed: ${message.message}`, severity: 'error' };
  }
}

function parse(payload: string): ServerMessage | null {
  try {
    const message = JSON.parse(payload) as ServerMessage;
    return typeof message?.type === 'string' && message.type.startsWith('gitlab:') ? message : null;
  } catch {
    return null;
  }
}
