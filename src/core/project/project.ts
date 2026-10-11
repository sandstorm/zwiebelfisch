// Project: the one place that knows which files a project has and which changes to them are allowed. One
// TypstDocument per .typ file (views edit it directly), the other files as bytes, the protected main file.
// Everyone who derives something from the files (views, indexes, collaboration, the preview) subscribes to
// `onDidChangeFile` and is never told by hand: `apply`, `replace` and every text edit are reported there.
// Entry of core/project/. See docs/architecture/core.typ.
import type { Disposable } from '../disposable/disposable';
import { EventEmitter, type Event } from '../event-emitter/event-emitter';
import { TypstDocument } from '../typst-document/typst-document';
import { ProjectPath } from '../paths/paths';

/** A project file: Typst source text, or bytes (images, data files, …). */
export type FileContent = string | Uint8Array;

/**
 * Project files by absolute path (`/chapter.typ`, `/img/logo.png`): source text or bytes. The plain data the
 * host and the engine exchange; `Project` parses its keys (see `ProjectPath`).
 */
export type ProjectFiles = Record<string, FileContent>;

/** One change to the project's files, as the host sees (and may veto) it. */
export type FileChange =
  | { kind: 'create'; path: ProjectPath; content: FileContent }
  /** Text of a Typst file (its document), or the new content of any other file. */
  | { kind: 'update'; path: ProjectPath; content: FileContent }
  | { kind: 'delete'; path: ProjectPath }
  | { kind: 'rename'; path: ProjectPath; from: ProjectPath };

/** The origin of the text edits `apply` and `replace` make: no view's, so every view shows them. */
const PROJECT_ORIGIN = Symbol('project');

/** A file: a Typst file's document (with the subscription that reports its edits), or any other file's content. */
type Entry = { kind: 'document'; document: TypstDocument; subscription: Disposable } | { kind: 'content'; content: FileContent };

/**
 * The files of a Typst project. Every `.typ` file is a `TypstDocument` that
 * views edit directly; other files (images, data) are kept as given. The main
 * file always exists and cannot be renamed or deleted.
 *
 * Listeners hear about every change: structural ones made through `apply`
 * and the text edits of every document.
 */
export class Project {
  private readonly entries = new Map<ProjectPath, Entry>();
  private readonly changed = new EventEmitter<FileChange>();
  /** Fires after every change of a file: `apply`, `replace`, and every text edit of a document (as `update`). */
  readonly onDidChangeFile: Event<FileChange> = this.changed.event;

  constructor(
    readonly main: ProjectPath,
    files: ProjectFiles,
  ) {
    for (const [path, content] of this.parse(files)) this.add(path, content);
    if (!this.entries.has(main)) this.add(main, '');
  }

  /** The main file, then other Typst files, then the rest; each group sorted. */
  paths(): ProjectPath[] {
    const rank = (path: ProjectPath) => (path === this.main ? 0 : ProjectPath.isTypst(path) ? 1 : 2);
    return [...this.entries.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  }

  has(path: ProjectPath): boolean {
    return this.entries.has(path);
  }

  document(path: ProjectPath): TypstDocument | undefined {
    const entry = this.entries.get(path);
    return entry?.kind === 'document' ? entry.document : undefined;
  }

  pathOf(document: TypstDocument): ProjectPath | undefined {
    for (const [path, entry] of this.entries) if (entry.kind === 'document' && entry.document === document) return path;
    return undefined;
  }

  content(path: ProjectPath): FileContent | undefined {
    const entry = this.entries.get(path);
    if (!entry) return undefined;
    return entry.kind === 'document' ? entry.document.text : entry.content;
  }

  /** Every file with its current content: what the compiler gets. */
  files(): ProjectFiles {
    return Object.fromEntries(this.paths().map((path) => [path, this.content(path)!]));
  }

  /** Why `change` cannot be applied, in words for people, or null if it can. */
  check(change: FileChange): string | null {
    if (change.kind === 'create') return this.checkNew(change.path) ?? checkContent(change.path, change.content);
    const existing = change.kind === 'rename' ? change.from : change.path;
    if (!this.entries.has(existing)) return `There is no file ${existing}.`;
    switch (change.kind) {
      case 'update':
        return this.checkUpdate(change.path, change.content);
      case 'delete':
        return change.path === this.main ? 'The main file cannot be deleted.' : null;
      case 'rename':
        return this.checkRename(change.from, change.path);
    }
  }

  /** Applies `change` and notifies listeners; throws when `check` refuses it. */
  apply(change: FileChange): void {
    const problem = this.check(change);
    if (problem) throw new Error(problem);
    if (change.kind === 'update') {
      const document = this.document(change.path);
      if (document) return document.setText(change.content as string, PROJECT_ORIGIN);
      this.entries.set(change.path, { kind: 'content', content: change.content });
    }
    if (change.kind === 'create') this.add(change.path, change.content);
    if (change.kind === 'delete') this.remove(change.path);
    if (change.kind === 'rename') this.move(change.from, change.path);
    this.changed.fire(change);
  }

  /**
   * Replaces the files with `files`, telling listeners as `apply` would: a `delete` per file that is gone, a
   * `create` per new one, an `update` per changed one. Documents of paths that stay are kept and get the new
   * text as one edit. The main file cannot be deleted: without an entry in `files` it keeps its text.
   */
  replace(files: ProjectFiles): void {
    const next = this.parse(files);
    for (const path of [...this.entries.keys()]) {
      if (path !== this.main && !next.has(path)) this.removeAndEmit(path);
    }
    for (const [path, content] of next) this.put(path, content);
  }

  dispose(): void {
    for (const path of [...this.entries.keys()]) this.remove(path);
    this.changed.dispose();
  }

  /** Host-given files by path; a key that is no path, or bytes for a Typst file, is the host's mistake: throws. */
  private parse(files: ProjectFiles): Map<ProjectPath, FileContent> {
    const parsed = new Map(Object.entries(files).map(([key, content]) => [parseKey(key), content]));
    for (const [path, content] of parsed) {
      if (ProjectPath.isTypst(path) && typeof content !== 'string') throw new Error(`The Typst file ${path} must contain text.`);
    }
    return parsed;
  }

  private checkNew(path: ProjectPath): string | null {
    return this.entries.has(path) ? `${path} already exists.` : null;
  }

  /** A Typst file takes only text; other files any content. */
  private checkUpdate(path: ProjectPath, content: FileContent): string | null {
    return this.document(path) && typeof content !== 'string' ? `${path} must contain text.` : null;
  }

  private checkRename(from: ProjectPath, to: ProjectPath): string | null {
    if (from === this.main) return 'The main file cannot be renamed.';
    if (ProjectPath.isTypst(from) !== ProjectPath.isTypst(to)) {
      return 'Typst files must keep the .typ ending, and other files cannot get it.';
    }
    return this.checkNew(to);
  }

  /** Sets the content of `path` for `replace`: an edit where the kind of entry stays, else a new file. */
  private put(path: ProjectPath, content: FileContent): void {
    const entry = this.entries.get(path);
    if (entry?.kind === 'document' && typeof content === 'string') return entry.document.setText(content, PROJECT_ORIGIN);
    if (entry?.kind === 'content' && !ProjectPath.isTypst(path)) {
      if (entry.content === content) return;
      this.entries.set(path, { kind: 'content', content });
      return this.changed.fire({ kind: 'update', path, content });
    }
    if (entry) this.removeAndEmit(path);
    this.add(path, content);
    this.changed.fire({ kind: 'create', path, content });
  }

  private removeAndEmit(path: ProjectPath): void {
    this.remove(path);
    this.changed.fire({ kind: 'delete', path });
  }

  private add(path: ProjectPath, content: FileContent): void {
    this.remove(path);
    if (!ProjectPath.isTypst(path)) {
      this.entries.set(path, { kind: 'content', content });
      return;
    }
    const document = new TypstDocument(content as string);
    const subscription = document.onDidChange(() => {
      const current = this.pathOf(document);
      if (current) this.changed.fire({ kind: 'update', path: current, content: document.text });
    });
    this.entries.set(path, { kind: 'document', document, subscription });
  }

  private remove(path: ProjectPath): void {
    const entry = this.entries.get(path);
    if (entry?.kind === 'document') entry.subscription.dispose();
    this.entries.delete(path);
  }

  private move(from: ProjectPath, to: ProjectPath): void {
    const entry = this.entries.get(from)!;
    this.entries.delete(from);
    this.entries.set(to, entry);
  }
}

/** A key of host-given `ProjectFiles` as a path; a key that is none is the host's mistake, so it throws. */
function parseKey(key: string): ProjectPath {
  const path = ProjectPath.parse(key);
  if (path === null) throw new Error(`Not a project path: "${key}" (paths start with "/", without "." or ".." segments)`);
  return path;
}

function checkContent(path: ProjectPath, content: FileContent): string | null {
  return ProjectPath.isTypst(path) && typeof content !== 'string' ? 'A .typ file must contain text.' : null;
}
