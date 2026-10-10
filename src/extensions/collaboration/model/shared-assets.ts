// SharedAssets: the project's non-Typst files in a GitLab-backed room. See model.ts.
import * as Y from 'yjs';
import { type FileChange, type Project } from '../../../core/project/project';
import { ProjectPath } from '../../../core/paths/paths';
import { ASSETS_MAP } from './gitlab-protocol';

type AssetValue = string | Uint8Array;

/**
 * Shares the project's other files (images, data) in a GitLab-backed room
 * through the Y.Doc map `assets`: path → blob sha (a file of the repository,
 * whose bytes `load` fetches from the server) or `Uint8Array` (uploaded, not
 * committed yet). Files created, renamed or deleted on either side reach the
 * other one; a delete and an add of the same value in one change is a rename.
 *
 * When the server has committed an upload it replaces the bytes by their
 * sha: that is no change of content, so nothing is loaded again.
 */
export class SharedAssets {
  private readonly assets: Y.Map<AssetValue>;
  private applying = false;
  private readonly unsubscribe: () => void;
  private destroyed = false;

  constructor(
    private readonly project: Project,
    private readonly ydoc: Y.Doc,
    private readonly load: (path: ProjectPath) => Promise<Uint8Array>,
  ) {
    this.assets = ydoc.getMap<AssetValue>(ASSETS_MAP);
    for (const [key, value] of this.assets) {
      const path = ProjectPath.parse(key);
      if (path) this.pull(path, value);
    }
    this.seed();
    this.assets.observe(this.onRemote);
    this.unsubscribe = project.onChange((change) => {
      if (!this.applying) this.push(change);
    });
  }

  destroy(): void {
    this.destroyed = true;
    this.unsubscribe();
    this.assets.unobserve(this.onRemote);
  }

  /** Local other files the room does not have yet become uploads. */
  private seed(): void {
    this.ydoc.transact(() => {
      for (const path of this.project.paths()) {
        if (!this.assets.has(path)) this.push({ kind: 'create', path, content: this.project.content(path)! });
      }
    }, this);
  }

  /** A local create / rename / delete of another file, into the map. */
  private push(change: FileChange): void {
    if (change.kind === 'update' || ProjectPath.kind(change.path) === 'typst') return;
    this.ydoc.transact(() => {
      if (change.kind === 'create') this.assets.set(change.path, bytes(change.content));
      if (change.kind === 'delete') this.assets.delete(change.path);
      if (change.kind === 'rename') {
        const value = this.assets.get(change.from);
        this.assets.delete(change.from);
        if (value !== undefined) this.assets.set(change.path, value);
      }
    }, this);
  }

  private readonly onRemote = (event: Y.YMapEvent<AssetValue>): void => {
    if (event.transaction.origin === this) return;
    // another client's keys: not trusted to be paths
    const changed = [...event.changes.keys].flatMap(([key, change]) => {
      const path = ProjectPath.parse(key);
      return path ? [[path, change] as const] : [];
    });
    const deleted = changed.filter(([, change]) => change.action === 'delete').map(([path]) => path);
    const added = changed.filter(([, change]) => change.action !== 'delete');
    if (deleted.length === 1 && added.length === 1 && this.renamed(deleted[0], added[0][0])) return;
    for (const path of deleted) this.apply({ kind: 'delete', path });
    for (const [path, change] of added) {
      const committed = change.oldValue instanceof Uint8Array && typeof this.assets.get(path) === 'string';
      if (!committed) this.pull(path, this.assets.get(path)!);
    }
  };

  /** Applies a remote rename (one file deleted, one with the same content added), if that is what happened. */
  private renamed(from: ProjectPath, to: ProjectPath): boolean {
    if (!this.project.has(from) || this.project.has(to)) return false;
    return this.apply({ kind: 'rename', from, path: to });
  }

  /** Puts the file at `path` with the map's `value` into the project (loading a repository file first). */
  private pull(path: ProjectPath, value: AssetValue): void {
    if (ProjectPath.kind(path) === 'typst') return;
    if (value instanceof Uint8Array) {
      this.put(path, value);
      return;
    }
    this.load(path).then(
      (content) => {
        if (!this.destroyed && this.assets.get(path) === value) this.put(path, content);
      },
      () => undefined,
    );
  }

  private put(path: ProjectPath, content: Uint8Array): void {
    if (this.project.has(path)) this.apply({ kind: 'delete', path });
    this.apply({ kind: 'create', path, content });
  }

  private apply(change: FileChange): boolean {
    if (this.project.check(change)) return false;
    this.applying = true;
    try {
      this.project.apply(change);
    } finally {
      this.applying = false;
    }
    return true;
  }
}

function bytes(content: string | Uint8Array): Uint8Array {
  return typeof content === 'string' ? new TextEncoder().encode(content) : content;
}
