// The files of a commit, shown read-only. See changes in changes.ts.
import { ProjectPath } from '../../core/paths/paths';
import { FilePermission, type FileStat, type FileSystemProvider } from '../../hosts/extension-host/workspace/workspace';
import type { SourceControlHistoryItem } from '../../hosts/scm/scm';
import { shortId } from './window/history-list';

/**
 * Files as they were at a commit, as read-only files outside the project (a `FileSystemProvider` of their own):
 * `/@84c6e2f/chapters/a.typ` is `/chapters/a.typ` at 84c6e2f. `add` keeps a file's text there (`readFile` then
 * serves it, `stat` says Readonly) until `retain` lets go of it.
 *
 * Used by: the changes extension, to show the files of a comparison that goes to a commit.
 */
export class Snapshots implements FileSystemProvider {
  readonly #files = new Map<ProjectPath, Snapshot>();

  /** Keeps `text`, the file `path` at commit `item`; returns where it is shown. */
  add(item: SourceControlHistoryItem, path: ProjectPath, text: string, originalPath?: ProjectPath): ProjectPath {
    const at = ProjectPath.of(`/@${shortId(item)}${path}`);
    this.#files.set(at, { item, path, text, ...(originalPath ? { originalPath } : {}) });
    return at;
  }

  /** The snapshot shown at `at`; undefined: none is. */
  get(at: ProjectPath | null | undefined): Snapshot | undefined {
    return at ? this.#files.get(at) : undefined;
  }

  /** Lets go of every snapshot but those `keep` holds. */
  retain(keep: (snapshot: Snapshot) => boolean): void {
    for (const [at, snapshot] of this.#files) if (!keep(snapshot)) this.#files.delete(at);
  }

  stat(path: ProjectPath | null): FileStat {
    return path !== null && this.#files.has(path) ? { permissions: FilePermission.Readonly } : {};
  }

  readFile(path: ProjectPath): string | undefined {
    return this.#files.get(path)?.text;
  }
}

/** A file as it was at a commit. */
export interface Snapshot {
  readonly item: SourceControlHistoryItem;
  /** Its path in the project. */
  readonly path: ProjectPath;
  /** Where it was before it was renamed, in the commit compared with. */
  readonly originalPath?: ProjectPath;
  /** Its text there; '' for a file not there (deleted). */
  readonly text: string;
}
