// GitLabRoom: one GitLab-backed room: loads the branch into the Y.Doc, commits versions, merges upstream pushes.
// See ARCHITECTURE.md, "GitLab-backed rooms".
import * as Y from 'yjs';
import { ASSETS_MAP, META_MAP, type RoomMeta, type ServerMessage } from '../../../src/features/collaboration/gitlab-protocol.ts';
import type { BlobCache } from './blob-cache.ts';
import { blobSha } from './blob-sha.ts';
import { commitActions, type RoomFiles } from './commit-actions.ts';
import { GitLabError, type GitLabProject } from './gitlab-api.ts';
import { mergeFiles, textEdits } from './merge.ts';

/** The widget's map of shared Typst files (path → Y.Text), see src/collab/shared-project.ts. */
const FILES_MAP = 'files';

/** How often a save merges upstream and tries again when the branch keeps moving. */
const SAVE_ATTEMPTS = 3;

export interface Author {
  name: string;
  email: string;
}

/**
 * One room backed by a GitLab branch: the room's Y.Doc holds the `.typ` files
 * (`files`), the other files (`assets`: blob sha or uploaded bytes) and the
 * repository state they are based on (`meta`, see gitlab-protocol.ts).
 *
 * Operations on a room run one after another. Everything the room knows lives
 * in the Y.Doc, so a room stored and loaded again (any storage) continues
 * where it was.
 */
export class GitLabRoom {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly doc: Y.Doc;
  private readonly project: GitLabProject;
  private readonly branch: string;
  private readonly blobs: BlobCache;

  constructor(doc: Y.Doc, project: GitLabProject, branch: string, blobs: BlobCache) {
    this.doc = doc;
    this.project = project;
    this.branch = branch;
    this.blobs = blobs;
  }

  /**
   * Loads the branch into a room that has no repository state yet; brings a
   * room that has one (stored earlier) up to date with upstream instead.
   */
  open(): Promise<ServerMessage | null> {
    return this.run(async () => {
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
   * Commits the room's changes since its base as one commit by `author`.
   * When upstream moved meanwhile, merges it first (as for `pull`) and tries
   * again; a conflict ends the save.
   */
  save(author: Author, message: string): Promise<ServerMessage> {
    return this.run(async () => {
      for (let attempt = 0; attempt < SAVE_ATTEMPTS; attempt++) {
        const result = await this.commit(author, message);
        if (result) return result;
      }
      return { type: 'gitlab:error', message: 'The branch keeps changing; try again.' };
    });
  }

  /** Merges upstream changes of the branch into the room (null: there were none). */
  pull(): Promise<ServerMessage | null> {
    return this.run(() => this.pullNow());
  }

  /** The bytes of one of the room's other files (null: no such file). */
  async asset(path: string): Promise<Uint8Array | null> {
    const value = this.doc.getMap(ASSETS_MAP).get(path);
    if (value instanceof Uint8Array) return value;
    if (typeof value !== 'string') return null;
    return this.blobs.get(value, () => this.project.blob(value));
  }

  private run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task);
    this.queue = result.catch(() => undefined);
    return result;
  }

  /** One commit attempt: the outcome, or null after merging an upstream that moved (try again). */
  private async commit(author: Author, message: string): Promise<ServerMessage | null> {
    const meta = this.meta()!;
    const files = this.files();
    const actions = commitActions(meta, files);
    if (!actions.length) return { type: 'gitlab:unchanged' };
    let commit: { sha: string; parent: string | null };
    try {
      commit = await this.project.commit({ branch: this.branch, message, author, actions });
    } catch (error) {
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
    if (conflicts.length) return { type: 'gitlab:conflict', sha: head, files: conflicts };
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

  private meta(): RoomMeta | null {
    const map = this.doc.getMap(META_MAP);
    if (typeof map.get('baseSha') !== 'string') return null;
    return Object.fromEntries(['baseSha', 'base', 'baseAssets', 'lastCommits'].map((key) => [key, map.get(key)])) as unknown as RoomMeta;
  }

  private writeMeta(meta: RoomMeta): void {
    const map = this.doc.getMap(META_MAP);
    for (const [key, value] of Object.entries(meta)) map.set(key, value);
  }
}

function replace(text: Y.Text, edit: { from: number; to: number; insert: string }): void {
  if (edit.to > edit.from) text.delete(edit.from, edit.to - edit.from);
  if (edit.insert) text.insert(edit.from, edit.insert);
}

/** Runs `task` for all `items`, at most `size` at a time. */
async function inBatches<T>(items: T[], size: number, task: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(task));
}
