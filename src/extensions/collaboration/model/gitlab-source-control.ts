// The commits of a GitLab-backed room. See Collaboration in model.ts.
import type * as Y from 'yjs';
import type { Disposable } from '../../../core/disposable/disposable';
import { EventEmitter, type Event } from '../../../core/event-emitter/event-emitter';
import type { GitLabHistory } from './gitlab-history';
import { ProjectPath } from '../../../core/paths/paths';
import {
  DEFAULT_COMMIT_MESSAGE,
  GUEST_EDITS,
  META_MAP,
  type ChangedFile,
  type ClientMessage,
  type CommitFailure,
  type RoomChanges,
  type RoomConflict,
  type ServerMessage,
} from '../room-protocol';

/**
 * The commits of a room backed by a GitLab branch, as a client sees them, shaped as the scm host's `SourceControl`:
 * - `commit` asks the server to commit the room's changes in the signed-in user's name (`busy` until it answers);
 *   a guest has none (members save their edits)
 * - the server's answers (saved, nothing to save, a conflict, a failure) and news (upstream merged) go to `tell`
 * - what the room has that the branch has not shows as resource states (M / A / D) and in the status bar
 * - a conflict with upstream shows as "!" on its files and a warning entry while it lasts; a failed commit as a
 *   warning entry until the next commit or merge ("Guest edits: a member must save" when guest edits held it back)
 * - the files' texts at the last commit (`meta.base`) are its quick diff's originals
 * - the branch's commits before are its `historyProvider`'s (given; disposed with it)
 */
export class GitLabSourceControl {
  readonly id = 'gitlab';
  readonly label = 'GitLab';
  readonly defaultCommitMessage = DEFAULT_COMMIT_MESSAGE;
  #busy = false;
  #resourceStates: readonly ResourceState[] = [];
  readonly #changed = new EventEmitter<void>();
  readonly onDidChange = this.#changed.event;
  readonly #subscription: Disposable;
  readonly #meta: Y.Map<unknown>;
  /** Fires `onDidChange` every minute while there are changes, for their age. */
  #ticker: ReturnType<typeof setInterval> | undefined;

  /** Asks the server to commit; undefined for a guest, who never commits. */
  readonly commit?: (message: string) => void;
  /** What a click on the status bar entries does, as their tooltips end. */
  readonly #click: { save: string; retry: string };

  readonly historyProvider?: GitLabHistory;

  /** `options.saves`: the local user may commit (default; false: a guest). */
  constructor(
    ydoc: Y.Doc,
    private readonly channel: StatelessChannel,
    private readonly tell: Tell,
    { historyProvider, saves = true }: { historyProvider?: GitLabHistory; saves?: boolean } = {},
  ) {
    this.historyProvider = historyProvider;
    if (saves) this.commit = (message) => this.#commit(message);
    this.#click = saves ? { save: 'Click to save.', retry: 'The changes stay here. Click to try again.' } : { save: 'A member saves them.', retry: 'The changes stay here; a member saves them.' };
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

  get busy(): boolean {
    return this.#busy;
  }

  /** The files with changes not in GitLab, badged M (modified), A (added) or D (deleted); conflicting files "!". */
  get resourceStates(): readonly ResourceState[] {
    return this.#resourceStates;
  }

  /**
   * Whether the room has changes not in GitLab that the server does not commit by itself: its auto-commit is off, a
   * conflict with upstream blocks every commit, or its last commit failed (GitLab unreachable).
   */
  get changesStayUncommitted(): boolean {
    if (this.#changes() === null) return false;
    return typeof this.#meta.get('autoCommit') !== 'number' || this.#conflict() !== null || this.#commitFailure() !== null;
  }

  /**
   * "Not in GitLab: 3 files · 14 min (Ann, Bob)" while the room has changes, else "Saved · <commit>"; before it, as
   * warnings, "Conflict with GitLab: main.typ" while upstream conflicts and "Saving to GitLab failed" after a failed
   * commit.
   */
  get statusBarItems(): readonly StatusBarItem[] {
    const conflict = this.#conflict();
    const failure = this.#commitFailure();
    const warning: StatusBarItem[] = [
      ...(conflict ? [{ title: conflictTitle(conflict), tooltip: conflictTooltip(conflict), backgroundColor: 'warning' as const }] : []),
      ...(failure ? [{ title: failureTitle(failure), tooltip: failureTooltip(failure, Date.now(), this.#click.retry), backgroundColor: 'warning' as const }] : []),
    ];
    const changes = this.#changes();
    if (changes) return [...warning, { title: notInGitLab(changes, Date.now()), tooltip: changesTooltip(changes, this.#meta.get('autoCommit'), this.#click.save) }];
    const sha = this.#meta.get('baseSha');
    if (typeof sha !== 'string') return warning;
    const saved = `Everything is in GitLab (commit ${sha.slice(0, 8)}).`;
    return [...warning, { title: `Saved · ${sha.slice(0, 8)}`, tooltip: this.commit ? `${saved} ${this.#click.save}` : saved }];
  }

  /** The text of a file at the last commit (`meta.base`); '' for a file added since. */
  readonly quickDiffProvider = {
    provideOriginalText: (path: ProjectPath): string => {
      const base = this.#meta.get('base') as Record<string, unknown> | null | undefined;
      const text = base?.[path];
      return typeof text === 'string' ? text : '';
    },
  };

  #commit(message: string): void {
    const request: ClientMessage = { type: 'gitlab:save', message };
    this.#setBusy(true);
    this.channel.send(JSON.stringify(request));
  }

  dispose(): void {
    this.#meta.unobserve(this.#metaChanged);
    clearInterval(this.#ticker);
    this.#subscription.dispose();
    this.#changed.dispose();
    this.historyProvider?.dispose();
  }

  readonly #metaChanged = (): void => {
    this.#follow();
    this.#changed.fire();
  };

  /** Takes in the room's changes and conflict: the resource states, and the ticker while there are changes. */
  #follow(): void {
    const changes = this.#changes();
    const conflicting = new Set(this.#conflict()?.paths);
    const kinds = new Map<string, ChangedFile['kind'] | 'conflict'>((changes?.files ?? []).map((file) => [file.path, file.kind]));
    for (const path of conflicting) kinds.set(path, 'conflict');
    this.#resourceStates = [...kinds].flatMap(([written, kind]) => {
      const path = ProjectPath.parse(written);
      return path ? [{ path, decorations: DECORATIONS[kind] }] : [];
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

  /** `meta.conflict`, as the server wrote it (checked). */
  #conflict(): RoomConflict | null {
    const conflict = this.#meta.get('conflict') as Partial<RoomConflict> | null | undefined;
    if (!conflict || typeof conflict.sha !== 'string' || !Array.isArray(conflict.paths)) return null;
    const paths = conflict.paths.filter((path) => typeof path === 'string');
    return paths.length ? { sha: conflict.sha, paths } : null;
  }

  /** `meta.commitFailure`, as the server wrote it (checked). */
  #commitFailure(): CommitFailure | null {
    const failure = this.#meta.get('commitFailure') as Partial<CommitFailure> | null | undefined;
    if (!failure || typeof failure.message !== 'string' || typeof failure.at !== 'number') return null;
    return { message: failure.message, at: failure.at };
  }

  #receive(message: ServerMessage): void {
    if (message.type === 'gitlab:missing') return;
    const { text, severity } = said(message);
    this.tell(text, severity);
    // upstream changes are news, not the answer to a commit under way
    if (message.type !== 'gitlab:merged') this.#setBusy(false);
  }

  #setBusy(busy: boolean): void {
    this.#busy = busy;
    this.#changed.fire();
  }
}

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

/** A status bar entry (the scm host's `SourceControlStatusBarItem`). */
export interface StatusBarItem {
  readonly title: string;
  readonly tooltip: string;
  readonly backgroundColor?: 'warning';
}

function parse(payload: string): ServerMessage | null {
  try {
    const message = JSON.parse(payload) as ServerMessage;
    return typeof message?.type === 'string' && message.type.startsWith('gitlab:') ? message : null;
  } catch {
    return null;
  }
}

/** "Conflict with GitLab: main.typ" (at most two files named). */
function conflictTitle(conflict: RoomConflict): string {
  const names = conflict.paths.map((path) => path.slice(1));
  return `Conflict with GitLab: ${names.slice(0, 2).join(', ')}${names.length > 2 ? ` and ${names.length - 2} more` : ''}`;
}

function conflictTooltip(conflict: RoomConflict): string {
  return [
    `Changes on GitLab (commit ${conflict.sha.slice(0, 8)}) conflict with edits here in:`,
    ...conflict.paths.map((path) => `! ${path.slice(1)}`),
    'Nothing is saved to GitLab until the lines match: change them here or on GitLab.',
  ].join('\n');
}

/** "Saving to GitLab failed", or "Guest edits: a member must save" when guest edits held an auto-save back. */
function failureTitle(failure: CommitFailure): string {
  return failure.message === GUEST_EDITS ? GUEST_EDITS.replace(/\.$/, '') : 'Saving to GitLab failed';
}

function failureTooltip(failure: CommitFailure, now: number, click: string): string {
  return [`The last save to GitLab (${age(now - failure.at)} ago) failed:`, failure.message, click].join('\n');
}

/** "< 1 min", "14 min", "2 h", "2 h 5 min". */
function age(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / MINUTE));
  if (minutes < 1) return '< 1 min';
  if (minutes < 60) return `${minutes} min`;
  return minutes % 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes / 60} h`;
}

/** How often the status bar entry's age ("14 min") is brought up to date. */
const MINUTE = 60_000;

/** "Not in GitLab: 3 files · 14 min (Ann, Bob)": how many files, for how long (at `now`), by whom. */
function notInGitLab(changes: RoomChanges, now: number): string {
  const count = changes.files.length;
  const by = changes.editors.length ? ` (${changes.editors.join(', ')})` : '';
  return `Not in GitLab: ${count} ${count === 1 ? 'file' : 'files'} · ${age(now - changes.since)}${by}`;
}

/** The changed files, one per line with its badge, when they are saved by themselves (`autoCommit` minutes), and what a click does. */
function changesTooltip(changes: RoomChanges, autoCommit: unknown, click: string): string {
  const lines = changes.files.map((file) => `${DECORATIONS[file.kind].badge} ${file.path.slice(1)}`);
  const automatic =
    typeof autoCommit === 'number'
      ? `Saved by itself after ${autoCommit} min without edits, and when the last person leaves.`
      : 'Not saved by itself: save before you leave.';
  return ['Not in GitLab yet:', ...lines, automatic, click].join('\n');
}

/** The badges of changed and conflicting files, as VS Code's explorer shows them. */
const DECORATIONS: Record<ChangedFile['kind'] | 'conflict', ResourceState['decorations']> = {
  modified: { badge: 'M', tooltip: 'Changed, not in GitLab yet', color: '#b58900' },
  added: { badge: 'A', tooltip: 'New, not in GitLab yet', color: '#859900' },
  deleted: { badge: 'D', tooltip: 'Deleted, not in GitLab yet', color: '#dc322f' },
  conflict: { badge: '!', tooltip: 'Conflicts with changes on GitLab: not saved until the lines match', color: '#dc322f' },
};

/** What to tell for `message`: the saved version, nothing to save, merged upstream changes, a conflict, a failure. */
function said(message: Exclude<ServerMessage, { type: 'gitlab:missing' }>): { text: string; severity: Parameters<Tell>[1] } {
  switch (message.type) {
    case 'gitlab:saved':
      return { text: `Saved version ${message.sha.slice(0, 8)}${message.automatic ? ' automatically' : ''} (${message.author})`, severity: 'info' };
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
