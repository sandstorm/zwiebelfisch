// GitLabRoom: one GitLab-backed room: loads the branch into the Y.Doc, commits versions (on a save, or by itself when
// the room is idle or left), merges upstream pushes, and keeps the room's uncommitted changes and conflicts in its
// meta map. See docs/architecture/server.typ.
import * as Y from 'yjs';
import {
  ASSETS_MAP,
  FILES_MAP,
  META_MAP,
  type RoomChanges,
  type RoomConflict,
  type RoomMeta,
  type ServerMessage,
} from '../../../src/core/room-protocol/room-protocol.ts';
import type { BlobCache } from './blob-cache.ts';
import { blobSha } from './blob-sha.ts';
import { changedFiles, commitActions, type RoomFiles } from './commit-actions.ts';
import { automaticCommit, Editors, withCoAuthors, type EditTally } from './editors.ts';
import { GitLabError, type GitLabProject } from './gitlab-api.ts';
import { mergeFiles, textEdits } from './merge.ts';

/** How often a save merges upstream and tries again when the branch keeps moving. */
const SAVE_ATTEMPTS = 3;

/** Milliseconds between an edit and the room's `changes` telling it (edits within it are told together). */
const CHANGES_DELAY = 500;

/** Milliseconds the room waits after the last user left before it commits by itself (they may be back: a reload). */
export const LEAVE_DELAY = 20_000;

const MINUTE = 60_000;

export interface Author {
  name: string;
  email: string;
}

export interface RoomOptions {
  blobs: BlobCache;
  /** Who made a change of the room's Y.Doc, from the change's transaction origin (never asked for the room's own); null: unknown. */
  editorOf(origin: unknown): Author | null;
  /** The email of an editor known by name only (one stored with the room). */
  authorEmail: string;
  /**
   * Minutes without edits after which the room commits its changes by itself; it does so, too, a little while after
   * the last user left (`left`). Null: never.
   */
  autoCommit: number | null;
  /** Tells everyone in the room the outcome of a commit the room made by itself. */
  broadcast(message: ServerMessage): void;
}

/** Who commits when nobody is known to have edited (a stored room's edits, made before the server started). */
const NOBODY = 'Typst editor';

/**
 * One room backed by a GitLab branch: the room's Y.Doc holds the `.typ` files
 * (`files`), the other files (`assets`: blob sha or uploaded bytes) and the
 * repository state they are based on (`meta`, see room-protocol.ts).
 *
 * Every change of the Y.Doc but the room's own is an edit by someone
 * (`options.editorOf`); what the edits changed against the base, since when and
 * by whom is kept in `meta.changes`, shortly after each edit and right after
 * each commit or merge. Every commit names the other editors as co-authors.
 * With `options.autoCommit` the room commits by itself when nobody edited for
 * that long, and when the last user left. Upstream changes that conflict with
 * the room's stay in `meta.conflict` until a merge succeeds.
 *
 * Operations on a room run one after another. Everything the room knows lives
 * in the Y.Doc, so a room stored and loaded again (any storage) continues
 * where it was; only the number of edits per editor starts over.
 */
export class GitLabRoom {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly doc: Y.Doc;
  private readonly project: GitLabProject;
  private readonly branch: string;
  private readonly blobs: BlobCache;
  private readonly options: RoomOptions;
  private readonly editors = new Editors();
  private changesTimer: ReturnType<typeof setTimeout> | undefined;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(doc: Y.Doc, project: GitLabProject, branch: string, options: RoomOptions) {
    this.doc = doc;
    this.project = project;
    this.branch = branch;
    this.blobs = options.blobs;
    this.options = options;
    doc.on('update', this.updated);
  }

  /**
   * Loads the branch into a room that has no repository state yet; brings a
   * room that has one (stored earlier) up to date with upstream instead.
   */
  open(): Promise<ServerMessage | null> {
    return this.run(async () => {
      const stored = this.changes();
      if (stored) {
        const author = (name: string) => ({ author: { name, email: this.options.authorEmail }, edits: 0 });
        this.editors.restore({ since: stored.since, editors: new Map(stored.editors.map((name) => [name, author(name)])) });
      }
      this.doc.transact(() => this.doc.getMap(META_MAP).set('autoCommit', this.options.autoCommit), this);
      // A stored room opens even when GitLab cannot be reached; the next pull or save catches up.
      if (this.meta()) return this.pullNow().catch(() => null);
      const snapshot = await this.snapshot(await this.project.head(this.branch));
      this.doc.transact(() => {
        const files = this.doc.getMap<Y.Text>(FILES_MAP);
        for (const [path, text] of Object.entries(snapshot.base)) files.set(path, new Y.Text(text));
        const assets = this.doc.getMap(ASSETS_MAP);
        for (const [path, sha] of Object.entries(snapshot.baseAssets)) assets.set(path, sha);
        this.writeMeta(snapshot);
      }, this);
      return null;
    });
  }

  /**
   * Commits the room's changes since its base as one commit by `author`, the
   * other editors as co-authors. When upstream moved meanwhile, merges it first
   * (as for `pull`) and tries again; a conflict ends the save.
   */
  save(author: Author, message: string): Promise<ServerMessage> {
    return this.run(() => this.commitAttempts((edits) => ({ author, message: withCoAuthors(message, edits, author) })));
  }

  /**
   * Commits the room's changes as `save` does, by itself: by whoever made the
   * most edits, with a message naming the editors and files (`automaticCommit`).
   */
  private autoSave(): Promise<ServerMessage> {
    const fallback = { name: NOBODY, email: this.options.authorEmail };
    return this.run(async () => {
      const result = await this.commitAttempts((edits, paths) => automaticCommit(edits, paths, fallback));
      return result.type === 'gitlab:saved' ? { ...result, automatic: true } : result;
    });
  }

  /**
   * The last user left: with auto-commit, commits the room's changes after
   * `LEAVE_DELAY`, unless someone is back by then (`alone` says).
   */
  async left(alone: () => boolean): Promise<void> {
    if (this.options.autoCommit === null || !this.hasChanges()) return;
    await new Promise((resolve) => setTimeout(resolve, LEAVE_DELAY));
    if (this.disposed || !alone()) return;
    await this.autoCommitNow();
  }

  /** Merges upstream changes of the branch into the room (null: there were none). */
  pull(): Promise<ServerMessage | null> {
    return this.run(() => this.pullNow());
  }

  /** Whether the room has changes its branch has not. */
  hasChanges(): boolean {
    const meta = this.meta();
    return !!meta && commitActions(meta, this.files()).length > 0;
  }

  /** Stops following edits (the room was unloaded). */
  dispose(): void {
    this.disposed = true;
    clearTimeout(this.changesTimer);
    clearTimeout(this.idleTimer);
    this.doc.off('update', this.updated);
  }

  /** The bytes of one of the room's other files (null: no such file). */
  async asset(path: string): Promise<Uint8Array | null> {
    const value = this.doc.getMap(ASSETS_MAP).get(path);
    if (value instanceof Uint8Array) return value;
    if (typeof value !== 'string') return null;
    return this.blobs.get(value, () => this.project.blob(value));
  }

  /** Runs `task` after the ones before it; then tells the room's changes. */
  private run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task).finally(() => this.tellChanges());
    this.queue = result.catch(() => undefined);
    return result;
  }

  /** A change of the Y.Doc: an edit, unless the room made it. */
  private readonly updated = (_update: Uint8Array, origin: unknown): void => {
    if (origin === this) return;
    this.editors.edited(this.options.editorOf(origin), Date.now());
    this.changesTimer ??= setTimeout(() => this.tellChanges(), CHANGES_DELAY);
    if (this.options.autoCommit === null) return;
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => void this.autoCommitNow(), this.options.autoCommit * MINUTE);
  };

  /** Commits by itself, if there is anything to commit, and tells the room how it went. */
  private async autoCommitNow(): Promise<void> {
    if (this.disposed || !this.hasChanges()) return;
    const result = await this.autoSave().catch((error: unknown): ServerMessage => ({ type: 'gitlab:error', message: String((error as Error)?.message ?? error) }));
    if (result.type !== 'gitlab:unchanged') this.options.broadcast(result);
  }

  /** Commit attempts until one is done or a conflict ends them; `compose` names the author and message. */
  private async commitAttempts(compose: Compose): Promise<ServerMessage> {
    for (let attempt = 0; attempt < SAVE_ATTEMPTS; attempt++) {
      const result = await this.commit(compose);
      if (result) return result;
    }
    return { type: 'gitlab:error', message: 'The branch keeps changing; try again.' };
  }

  /** Writes what the room has that the branch has not into `meta.changes` (if that changed). */
  private tellChanges(): void {
    clearTimeout(this.changesTimer);
    this.changesTimer = undefined;
    const meta = this.meta();
    if (this.disposed || !meta) return;
    const files = changedFiles(commitActions(meta, this.files()));
    // edits that were undone, or committed meanwhile
    if (!files.length) this.editors.take();
    else if (this.editors.since === null) this.editors.restore({ since: Date.now(), editors: new Map() });
    const changes: RoomChanges | null = files.length ? { files, since: this.editors.since!, editors: this.editors.names } : null;
    if (JSON.stringify(changes) === JSON.stringify(this.changes())) return;
    this.doc.transact(() => this.doc.getMap(META_MAP).set('changes', changes), this);
  }

  /** One commit attempt: the outcome, or null after merging an upstream that moved (try again). */
  private async commit(compose: Compose): Promise<ServerMessage | null> {
    const meta = this.meta()!;
    const files = this.files();
    const actions = commitActions(meta, files);
    if (!actions.length) return { type: 'gitlab:unchanged' };
    // the edits in `files`; edits made while the commit runs stay for the next one
    const edits = this.editors.take();
    const { author, message } = compose(edits, changedFiles(actions).map((file) => file.path));
    let commit: { sha: string; parent: string | null };
    try {
      commit = await this.project.commit({ branch: this.branch, message, author, actions });
    } catch (error) {
      this.editors.restore(edits);
      if (!(error instanceof GitLabError) || error.status >= 500) throw error;
      const head = await this.project.head(this.branch);
      if (head === meta.baseSha) return { type: 'gitlab:error', message: error.message };
      const merged = await this.merge(head);
      return merged.type === 'gitlab:conflict' ? merged : null;
    }
    this.committed(meta, files, commit.sha);
    // Someone else's commit (to other files) landed between ours and our base.
    if (commit.parent !== meta.baseSha) await this.merge(commit.sha);
    return { type: 'gitlab:saved', sha: commit.sha, author: author.name };
  }

  private async pullNow(): Promise<ServerMessage | null> {
    const head = await this.project.head(this.branch);
    return head === this.meta()?.baseSha ? null : this.merge(head);
  }

  /**
   * Merges the branch at `head` into the room: per file three-way (base vs
   * upstream vs room), applied as small Y.Text edits. On a conflict nothing
   * changes and the conflict is the result.
   */
  private async merge(head: string): Promise<ServerMessage> {
    const upstream = await this.snapshot(head);
    const meta = this.meta()!;
    const current = this.files();
    const { changes, conflicts } = mergeFiles(meta.base, current.texts, upstream.base);
    if (conflicts.length) {
      const conflict: RoomConflict = { sha: head, paths: conflicts.map((file) => file.path) };
      this.doc.transact(() => this.doc.getMap(META_MAP).set('conflict', conflict), this);
      return { type: 'gitlab:conflict', sha: head, files: conflicts };
    }
    this.doc.transact(() => {
      const files = this.doc.getMap<Y.Text>(FILES_MAP);
      for (const [path, text] of Object.entries(changes)) {
        const shared = files.get(path);
        if (text === null) files.delete(path);
        else if (!shared) files.set(path, new Y.Text(text));
        else for (const edit of textEdits(shared.toString(), text).reverse()) replace(shared, edit);
      }
      this.mergeAssets(meta.baseAssets, current.assets, upstream.baseAssets);
      this.writeMeta(upstream);
    }, this);
    return { type: 'gitlab:merged', sha: head };
  }

  /** Upstream's changes to other files, where the room did not change them (else the room's version stays). */
  private mergeAssets(base: Record<string, string>, current: RoomFiles['assets'], upstream: Record<string, string>): void {
    const assets = this.doc.getMap(ASSETS_MAP);
    for (const path of new Set([...Object.keys(base), ...Object.keys(upstream)])) {
      if (upstream[path] === base[path] || current[path] !== base[path]) continue;
      if (upstream[path] === undefined) assets.delete(path);
      else assets.set(path, upstream[path]);
    }
  }

  /** After a commit of `files` as `sha`: they are the new base; uploads become repository files. */
  private committed(meta: RoomMeta, files: RoomFiles, sha: string): void {
    const lastCommits: Record<string, string> = {};
    for (const [path, text] of Object.entries(files.texts)) {
      lastCommits[path] = meta.base[path] === text ? meta.lastCommits[path] : sha;
    }
    const known = new Set(Object.values(meta.baseAssets));
    const baseAssets: Record<string, string> = {};
    const uploads: [string, Uint8Array, string][] = [];
    for (const [path, value] of Object.entries(files.assets)) {
      if (typeof value === 'string') {
        if (known.has(value)) baseAssets[path] = value;
        continue;
      }
      baseAssets[path] = blobSha(value);
      uploads.push([path, value, baseAssets[path]]);
      this.blobs.put(baseAssets[path], value);
    }
    this.doc.transact(() => {
      const assets = this.doc.getMap(ASSETS_MAP);
      for (const [path, bytes, blob] of uploads) if (assets.get(path) === bytes) assets.set(path, blob);
      this.writeMeta({ baseSha: sha, base: files.texts, baseAssets, lastCommits });
    }, this);
  }

  /** The repository at `sha`: `.typ` files with text and last commit, the other files by blob sha. */
  private async snapshot(sha: string): Promise<RoomMeta> {
    const snapshot: RoomMeta = { baseSha: sha, base: {}, baseAssets: {}, lastCommits: {} };
    const decoder = new TextDecoder();
    const typst = [];
    for (const entry of await this.project.tree(sha)) {
      if (entry.path.endsWith('.typ')) typst.push(entry.path);
      else snapshot.baseAssets[entry.path] = entry.sha;
    }
    await inBatches(typst, 8, async (path) => {
      const file = await this.project.file(path, sha);
      snapshot.base[path] = decoder.decode(file.content);
      snapshot.lastCommits[path] = file.lastCommitId;
    });
    return snapshot;
  }

  private files(): RoomFiles {
    const texts: Record<string, string> = {};
    for (const [path, text] of this.doc.getMap<Y.Text>(FILES_MAP)) texts[path] = text.toString();
    const assets: RoomFiles['assets'] = {};
    for (const [path, value] of this.doc.getMap(ASSETS_MAP)) {
      if (typeof value === 'string' || value instanceof Uint8Array) assets[path] = value;
    }
    return { texts, assets };
  }

  private changes(): RoomChanges | null {
    return (this.doc.getMap(META_MAP).get('changes') as RoomChanges | null | undefined) ?? null;
  }

  private meta(): RoomMeta | null {
    const map = this.doc.getMap(META_MAP);
    if (typeof map.get('baseSha') !== 'string') return null;
    return Object.fromEntries(['baseSha', 'base', 'baseAssets', 'lastCommits'].map((key) => [key, map.get(key)])) as unknown as RoomMeta;
  }

  /** A new base (loaded, merged or committed): any conflict is resolved. */
  private writeMeta(meta: RoomMeta): void {
    const map = this.doc.getMap(META_MAP);
    for (const [key, value] of Object.entries(meta)) map.set(key, value);
    if (map.get('conflict')) map.set('conflict', null);
  }
}

/** The author and message of a commit of `edits`, which changes the files at `paths`. */
type Compose = (edits: EditTally, paths: string[]) => { author: Author; message: string };

function replace(text: Y.Text, edit: { from: number; to: number; insert: string }): void {
  if (edit.to > edit.from) text.delete(edit.from, edit.to - edit.from);
  if (edit.insert) text.insert(edit.from, edit.insert);
}

/** Runs `task` for all `items`, at most `size` at a time. */
async function inBatches<T>(items: T[], size: number, task: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(task));
}
