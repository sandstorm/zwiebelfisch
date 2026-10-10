// Project: the file model of the widget: one TypstDocument per .typ file, the other files as bytes, the
// protected main file. Entry of core/project/. See ARCHITECTURE.md, "createTypstEditor".
import { TypstDocument } from '../typst-document/typst-document';
import { fileKind } from './paths';

export { displayName, extensionOf, fileKind, imageBlob, referencePath, resolvePath, toPath, type FileKind } from './paths';
export { neighbours, readingOrder } from './reading-order';
export { importChange, type ImportRequest } from './imports';
export { describeLink, findPathReferences, pathReferenceAt, type FileLinks, type LinkTarget, type PathCall, type PathReference } from './path-references';

/** The drag data type of a project file dragged from the file panel; the data is its path. */
export const PROJECT_PATH_TYPE = 'application/x-typst-project-path';

/** A project file: Typst source text, or bytes (images, data files, …). */
export type FileContent = string | Uint8Array;

/** Project files by absolute path (`/chapter.typ`, `/img/logo.png`): source text or bytes. */
export type ProjectFiles = Record<string, FileContent>;

/** One change to the project's files, as the host sees (and may veto) it. */
export type FileChange =
  | { kind: 'create'; path: string; content: FileContent }
  /** Text of a Typst file (its document), or the new content of any other file. */
  | { kind: 'update'; path: string; content: FileContent }
  | { kind: 'delete'; path: string }
  | { kind: 'rename'; path: string; from: string };

type Entry = { document: TypstDocument; unsubscribe: () => void } | { content: FileContent };

/**
 * The files of a Typst project. Every `.typ` file is a `TypstDocument` that
 * views edit directly; other files (images, data) are kept as given. The main
 * file always exists and cannot be renamed or deleted.
 *
 * Listeners hear about every change: structural ones made through `apply`
 * and the text edits of every document.
 */
export class Project {
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Set<(change: FileChange) => void>();

  constructor(
    readonly main: string,
    files: ProjectFiles,
  ) {
    for (const [path, content] of Object.entries(files)) this.add(path, content);
    if (!this.entries.has(main)) this.add(main, '');
  }

  /** The main file, then other Typst files, then the rest; each group sorted. */
  paths(): string[] {
    const rank = (path: string) => (path === this.main ? 0 : fileKind(path) === 'typst' ? 1 : 2);
    return [...this.entries.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  }

  has(path: string): boolean {
    return this.entries.has(path);
  }

  document(path: string): TypstDocument | undefined {
    const entry = this.entries.get(path);
    return entry && 'document' in entry ? entry.document : undefined;
  }

  pathOf(document: TypstDocument): string | undefined {
    for (const [path, entry] of this.entries) if ('document' in entry && entry.document === document) return path;
    return undefined;
  }

  content(path: string): FileContent | undefined {
    const entry = this.entries.get(path);
    if (!entry) return undefined;
    return 'document' in entry ? entry.document.text : entry.content;
  }

  /** Every file with its current content: what the compiler gets. */
  files(): ProjectFiles {
    return Object.fromEntries(this.paths().map((path) => [path, this.content(path)!]));
  }

  /** Every file except the main one. */
  otherFiles(): ProjectFiles {
    const files = this.files();
    delete files[this.main];
    return files;
  }

  /** Why `change` cannot be applied, in words for people, or null if it can. */
  check(change: FileChange): string | null {
    if (change.kind === 'create') return this.checkNew(change.path) ?? checkContent(change.path, change.content);
    const existing = change.kind === 'rename' ? change.from : change.path;
    if (!this.entries.has(existing)) return `There is no file ${existing}.`;
    switch (change.kind) {
      case 'update':
        return this.document(change.path) && typeof change.content !== 'string' ? `${change.path} must contain text.` : null;
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
      if (document) return document.setText(change.content as string, 'api');
      this.entries.set(change.path, { content: change.content });
    }
    if (change.kind === 'create') this.add(change.path, change.content);
    if (change.kind === 'delete') this.remove(change.path);
    if (change.kind === 'rename') this.move(change.from, change.path);
    this.emit(change);
  }

  /**
   * Replaces all files but the main one (its entry in `files` is ignored).
   * Documents of paths that stay are kept and get the new text as one edit.
   */
  replace(files: ProjectFiles): void {
    for (const path of [...this.entries.keys()]) {
      if (path !== this.main && !(path in files)) this.remove(path);
    }
    for (const [path, content] of Object.entries(files)) {
      if (path === this.main) continue;
      const document = this.document(path);
      if (document && typeof content === 'string') document.setText(content, 'api');
      else this.add(path, content);
    }
  }

  /** Subscribes to changes; returns the unsubscribe function. */
  onChange(listener: (change: FileChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  destroy(): void {
    for (const path of [...this.entries.keys()]) this.remove(path);
    this.listeners.clear();
  }

  private checkNew(path: string): string | null {
    return this.entries.has(path) ? `${path} already exists.` : null;
  }

  private checkRename(from: string, to: string): string | null {
    if (from === this.main) return 'The main file cannot be renamed.';
    if ((fileKind(from) === 'typst') !== (fileKind(to) === 'typst')) {
      return 'Typst files must keep the .typ ending, and other files cannot get it.';
    }
    return this.checkNew(to);
  }

  private add(path: string, content: FileContent): void {
    this.remove(path);
    if (fileKind(path) !== 'typst' || typeof content !== 'string') {
      this.entries.set(path, { content });
      return;
    }
    const document = new TypstDocument(content);
    const unsubscribe = document.onChange(() => {
      const current = this.pathOf(document);
      if (current) this.emit({ kind: 'update', path: current, content: document.text });
    });
    this.entries.set(path, { document, unsubscribe });
  }

  private remove(path: string): void {
    const entry = this.entries.get(path);
    if (entry && 'unsubscribe' in entry) entry.unsubscribe();
    this.entries.delete(path);
  }

  private move(from: string, to: string): void {
    const entry = this.entries.get(from)!;
    this.entries.delete(from);
    this.entries.set(to, entry);
  }

  private emit(change: FileChange): void {
    for (const listener of this.listeners) listener(change);
  }
}

function checkContent(path: string, content: FileContent): string | null {
  return fileKind(path) === 'typst' && typeof content !== 'string' ? 'A .typ file must contain text.' : null;
}
