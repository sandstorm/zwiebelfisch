// GitLabSourceControl. See model.ts.
import type * as Y from 'yjs';
import type { Disposable } from '../../../core/disposable/disposable';
import { EventEmitter, type Event } from '../../../core/event-emitter/event-emitter';
import { ProjectPath } from '../../../core/paths/paths';
import {
  DEFAULT_COMMIT_MESSAGE,
  META_MAP,
  type ChangedFile,
  type ClientMessage,
  type CommitFailure,
  type RoomChanges,
  type RoomConflict,
  type ServerMessage,
} from '../../../core/room-protocol/room-protocol';

/**
 * The commits of a room backed by a GitLab branch, as a client sees them: `commit` asks the server to commit the
 * room's changes as `author` (`state.busy` until it answers); the server's answers (saved, nothing to save, a
 * conflict, a failure) and its news (upstream changes merged) are told with `tell`. What the room has that the branch
 * has not (written by the server into the room's meta map) is shown as resource states (M / A / D) and in the status
 * bar ("Not in GitLab: 3 files · 14 min (Ann, Bob)", or "Saved · 01234567"); a conflict with upstream, as long as it
 * lasts, as "!" on its files and a warning entry before that; a failed commit (GitLab unreachable), until the next
 * commit or merge, as a warning entry, too. Shaped as the scm host's `SourceControl`.
 *
 * The GitLab branch behind a room as a source control (`scm.registerSourceControl`): commit asks the server to commit
 * over stateless messages; the server's answers and news are told as messages; what the room has that the branch has
 * not (the server's `meta.changes`), a conflict with upstream (`meta.conflict`) and a failed commit
 * (`meta.commitFailure`) are its resource states and status bar entries.
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
  get statusBarCommands(): readonly StatusBarCommand[] {
    const conflict = this.#conflict();
    const failure = this.#commitFailure();
    const warning: StatusBarCommand[] = [
      ...(conflict ? [{ title: conflictTitle(conflict), tooltip: conflictTooltip(conflict), backgroundColor: 'warning' as const }] : []),
      ...(failure ? [{ title: 'Saving to GitLab failed', tooltip: failureTooltip(failure, Date.now()), backgroundColor: 'warning' as const }] : []),
    ];
    const changes = this.#changes();
    if (changes) return [...warning, { title: notInGitLab(changes, Date.now()), tooltip: changesTooltip(changes, this.#meta.get('autoCommit')) }];
    const sha = this.#meta.get('baseSha');
    if (typeof sha !== 'string') return warning;
    return [...warning, { title: `Saved · ${sha.slice(0, 8)}`, tooltip: `Everything is in GitLab (commit ${sha.slice(0, 8)}). Click to save.` }];
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

/** A status bar entry (the scm host's `SourceControlStatusBarCommand`). */
export interface StatusBarCommand {
  readonly title: string;
  readonly tooltip: string;
  readonly backgroundColor?: 'warning';
}

/** Whether a commit is under way (the scm host's `SourceControlState`). */
export interface CommitState {
  readonly busy: boolean;
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

function failureTooltip(failure: CommitFailure, now: number): string {
  return [
    `The last save to GitLab (${age(now - failure.at)} ago) failed:`,
    failure.message,
    'The changes stay here. Click to try again.',
  ].join('\n');
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
function changesTooltip(changes: RoomChanges, autoCommit: unknown): string {
  const lines = changes.files.map((file) => `${DECORATIONS[file.kind].badge} ${file.path.slice(1)}`);
  const automatic =
    typeof autoCommit === 'number'
      ? `Saved by itself after ${autoCommit} min without edits, and when the last person leaves.`
      : 'Not saved by itself: save before you leave.';
  return ['Not in GitLab yet:', ...lines, automatic, 'Click to save.'].join('\n');
}

/** The badges of changed and conflicting files, as VS Code's explorer shows them. */
const DECORATIONS: Record<ChangedFile['kind'] | 'conflict', ResourceState['decorations']> = {
  modified: { badge: 'M', tooltip: 'Changed, not in GitLab yet', color: '#b58900' },
  added: { badge: 'A', tooltip: 'New, not in GitLab yet', color: '#859900' },
  deleted: { badge: 'D', tooltip: 'Deleted, not in GitLab yet', color: '#dc322f' },
  conflict: { badge: '!', tooltip: 'Conflicts with changes on GitLab: not saved until the lines match', color: '#dc322f' },
};

/** What to tell for `message`: the saved version, nothing to save, merged upstream changes, a conflict, a failure. */
function said(message: ServerMessage): { text: string; severity: Parameters<Tell>[1] } {
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
