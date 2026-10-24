// The history of a GitLab-backed room's branch. See GitLabSourceControl in gitlab-source-control.ts.
import type * as Y from 'yjs';
import { EventEmitter } from '../../../core/event-emitter/event-emitter';
import { ProjectPath } from '../../../core/paths/paths';
import { gitlabRoom, META_MAP, roomComparePath, roomFilePath, roomHistoryPath, type CompareAnswer, type HistoryCommit, type HistoryPage } from '../room-protocol';

/**
 * The commits of a GitLab room's branch, read from the server's clone with the session cookie (the scm host's
 * `SourceControlHistoryProvider`): pages of commits of the room (in a room of one folder: the folder), of a folder or
 * of a file; the files a commit changed, or that differ between two; a file at a commit. The current commit is the room's base (`meta.baseSha`):
 * `onDidChangeCurrentHistoryItem` fires when it moves. Answers that name a commit are the browser's to cache.
 *
 * Used by: GitLabSourceControl, as its `historyProvider`.
 */
export class GitLabHistory {
  readonly #moved = new EventEmitter<void>();
  readonly onDidChangeCurrentHistoryItem = this.#moved.event;
  readonly #meta: Y.Map<unknown>;

  /** `base`: the server's HTTP base URL; `room`: the room's name; `ydoc`: the room's Y.Doc. */
  constructor(
    private readonly base: string,
    private readonly room: string,
    ydoc: Y.Doc,
  ) {
    this.#meta = ydoc.getMap(META_MAP);
    this.#meta.observe(this.#metaChanged);
  }

  async provideHistoryItems({ scope, cursor, limit }: HistoryOptions): Promise<{ items: HistoryItem[]; cursor?: string }> {
    const path = scope?.kind === 'folder' ? `${scope.path}/` : scope?.path;
    const page = (await this.#json(roomHistoryPath(this.room, { path, cursor, limit }))) as HistoryPage;
    return { items: page.commits.map(item), cursor: page.cursor || undefined };
  }

  /** The room's base commit, under the branch's name; undefined before the room has one. */
  get currentHistoryItemRef(): { id: string; name: string } | undefined {
    const id = this.#meta.get('baseSha');
    return typeof id === 'string' && id ? { id, name: gitlabRoom(this.room)?.branch ?? '' } : undefined;
  }

  async provideHistoryItemChanges(historyItemId: string, historyItemParentId?: string): Promise<HistoryItemChange[]> {
    const answer = (await this.#json(roomComparePath(this.room, historyItemId, historyItemParentId))) as CompareAnswer;
    return answer.files.flatMap((file) => {
      const path = ProjectPath.parse(file.path);
      const originalPath = file.previousPath ? ProjectPath.parse(file.previousPath) : null;
      return path ? [{ path, kind: file.kind, ...(originalPath ? { originalPath } : {}) }] : [];
    });
  }

  async provideFileContent(historyItemId: string, path: ProjectPath): Promise<Uint8Array | undefined> {
    const response = await fetch(this.base + roomFilePath(this.room, path, historyItemId), { credentials: 'include' });
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`${path} at ${historyItemId.slice(0, 7)}: HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }

  dispose(): void {
    this.#meta.unobserve(this.#metaChanged);
    this.#moved.dispose();
  }

  readonly #metaChanged = (event: Y.YMapEvent<unknown>): void => {
    if (event.keysChanged.has('baseSha')) this.#moved.fire();
  };

  async #json(path: string): Promise<unknown> {
    const response = await fetch(this.base + path, { credentials: 'include' });
    if (!response.ok) throw new Error(`The history: HTTP ${response.status}`);
    return response.json();
  }
}

/** What `provideHistoryItems` lists (the scm host's `SourceControlHistoryOptions`). */
export interface HistoryOptions {
  readonly scope?: { readonly kind: 'file' | 'folder'; readonly path: ProjectPath };
  readonly cursor?: string;
  readonly limit?: number;
}

/** A commit (the scm host's `SourceControlHistoryItem`). */
export interface HistoryItem {
  readonly id: string;
  readonly parentIds: readonly string[];
  readonly subject: string;
  readonly message: string;
  readonly displayId: string;
  readonly author?: string;
  readonly coAuthors: readonly string[];
  readonly timestamp: number;
}

/** A file a commit changed (the scm host's `SourceControlHistoryItemChange`). */
export interface HistoryItemChange {
  readonly path: ProjectPath;
  readonly originalPath?: ProjectPath;
  readonly kind: CompareAnswer['files'][number]['kind'];
}

function item(commit: HistoryCommit): HistoryItem {
  const [author, ...coAuthors] = commit.people;
  return {
    id: commit.sha,
    parentIds: commit.parents,
    subject: commit.message.split('\n', 1)[0],
    message: commit.message,
    displayId: commit.sha.slice(0, 7),
    author,
    coAuthors,
    timestamp: commit.at,
  };
}
