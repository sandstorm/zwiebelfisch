// GitLabSourceControl: the GitLab branch behind a room as a source control (`Workbench.registerSourceControl`):
// commit asks the server to commit over stateless messages, and the server's answers become its state. See model.ts.
import type * as Y from 'yjs';
import type { Disposable } from '../../../core/disposable/disposable';
import { EventEmitter, type Event } from '../../../core/event-emitter/event-emitter';
import { DEFAULT_COMMIT_MESSAGE, META_MAP, type ClientMessage, type ServerMessage } from '../../../core/gitlab-protocol/gitlab-protocol';

/** Stateless messages to and from the server (the Hocuspocus provider's). */
export interface StatelessChannel {
  send(payload: string): void;
  /** Fires with every message from the server. */
  readonly onDidReceiveMessage: Event<string>;
}

/**
 * The commits of a room backed by a GitLab branch, as a client sees them: `commit` asks the server to commit the
 * room's changes as `author`; the server's answers (saved, nothing to save, a conflict, a failure) and its news
 * (upstream changes merged) show in `state`. Shaped as the workbench's `SourceControl`.
 */
export class GitLabSourceControl {
  readonly id = 'gitlab';
  readonly label = 'GitLab';
  readonly defaultCommitMessage = DEFAULT_COMMIT_MESSAGE;
  #state: CommitState = { busy: false, status: null };
  readonly #changed = new EventEmitter<void>();
  readonly onDidChange = this.#changed.event;
  readonly #subscription: Disposable;

  constructor(
    private readonly channel: StatelessChannel,
    private readonly author?: { name: string },
  ) {
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

  commit(message: string): void {
    const request: ClientMessage = { type: 'gitlab:save', message, ...(this.author ? { author: this.author } : {}) };
    this.#set({ busy: true, status: null });
    this.channel.send(JSON.stringify(request));
  }

  dispose(): void {
    this.#subscription.dispose();
    this.#changed.dispose();
  }

  #receive(message: ServerMessage): void {
    // upstream changes are news, not the answer to a commit under way
    this.#set({ busy: message.type === 'gitlab:merged' && this.#state.busy, status: commitStatus(message) });
  }

  #set(state: CommitState): void {
    this.#state = state;
    this.#changed.fire();
  }
}

/** A commit under way, and the last outcome or news as a message (the workbench's `SourceControlState`). */
export interface CommitState {
  readonly busy: boolean;
  readonly status: CommitStatus | null;
}

export interface CommitStatus {
  readonly message: string;
  readonly severity: 'info' | 'warning' | 'error';
}

/** The message for `message`: the saved version, nothing to save, merged upstream changes, a conflict, a failure. */
function commitStatus(message: ServerMessage): CommitStatus {
  switch (message.type) {
    case 'gitlab:saved':
      return { message: `Saved version ${message.sha.slice(0, 8)} (${message.author})`, severity: 'info' };
    case 'gitlab:unchanged':
      return { message: 'No changes to save', severity: 'info' };
    case 'gitlab:merged':
      return { message: 'Merged new changes from GitLab', severity: 'info' };
    case 'gitlab:conflict':
      return { message: `Changes on GitLab conflict with edits in ${message.files.map((file) => file.path).join(', ')}; not saved`, severity: 'warning' };
    case 'gitlab:error':
      return { message: `Saving failed: ${message.message}`, severity: 'error' };
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
