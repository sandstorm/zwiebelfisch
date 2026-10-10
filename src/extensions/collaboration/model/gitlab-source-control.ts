// GitLabSourceControl: the GitLab branch behind a room as a source control (`Workbench.registerSourceControl`):
// commit asks the server to commit over stateless messages, and the server's answers become its state. See model.ts.
import type * as Y from 'yjs';
import { EventEmitter } from '../../../core/event-emitter/event-emitter';
import { DEFAULT_COMMIT_MESSAGE, META_MAP, type ClientMessage, type ServerMessage } from '../../../core/gitlab-protocol/gitlab-protocol';

/** Stateless messages to and from the server (the Hocuspocus provider's). */
export interface StatelessChannel {
  send(payload: string): void;
  /** Subscribes to messages from the server; returns the unsubscribe function. */
  listen(listener: (payload: string) => void): () => void;
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
  #state = { busy: false, status: '' };
  readonly #changed = new EventEmitter<void>();
  readonly onDidChange = this.#changed.event;
  readonly #unsubscribe: () => void;

  constructor(
    private readonly channel: StatelessChannel,
    private readonly author?: { name: string },
  ) {
    this.#unsubscribe = channel.listen((payload) => {
      const message = parse(payload);
      if (message) this.#receive(message);
    });
  }

  /** Whether `ydoc` is the Y.Doc of a GitLab-backed room (its server put the last commit's sha there). */
  static isGitLabRoom(ydoc: Y.Doc): boolean {
    return typeof ydoc.getMap(META_MAP).get('baseSha') === 'string';
  }

  get state(): { readonly busy: boolean; readonly status: string } {
    return this.#state;
  }

  commit(message: string): void {
    const request: ClientMessage = { type: 'gitlab:save', message, ...(this.author ? { author: this.author } : {}) };
    this.#set({ busy: true, status: 'Saving…' });
    this.channel.send(JSON.stringify(request));
  }

  dispose(): void {
    this.#unsubscribe();
    this.#changed.dispose();
  }

  #receive(message: ServerMessage): void {
    // upstream changes are news, not the answer to a commit under way
    this.#set({ busy: message.type === 'gitlab:merged' && this.#state.busy, status: commitStatus(message) });
  }

  #set(state: { busy: boolean; status: string }): void {
    this.#state = state;
    this.#changed.fire();
  }
}

/** The status line for `message`: the saved version, nothing to save, merged upstream changes, a conflict, a failure. */
export function commitStatus(message: ServerMessage): string {
  switch (message.type) {
    case 'gitlab:saved':
      return `Saved version ${message.sha.slice(0, 8)} (${message.author})`;
    case 'gitlab:unchanged':
      return 'No changes to save';
    case 'gitlab:merged':
      return 'Merged new changes from GitLab';
    case 'gitlab:conflict':
      return `Changes on GitLab conflict with edits in ${message.files.map((file) => file.path).join(', ')}; not saved`;
    case 'gitlab:error':
      return `Saving failed: ${message.message}`;
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
