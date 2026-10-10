// ChangeTracking: the base version of every Typst file and the "Changes since …" toggle; the views and the
// preview mark what changed. Entry of features/changes/. See ARCHITECTURE.md, "ChangeTracking".
import { diffTexts } from './diff';
import type { ProjectPath } from '../../core/paths/paths';
import type { Project } from '../../core/project/project';
import type { TypstDocument } from '../../core/typst-document/typst-document';

export { diffTexts, type Change } from './diff';

/** A version to compare with, and how the toggle names it ("Changes since <label>"). */
export interface Base {
  text: string;
  label: string;
}

/** An editing view that renders the changes of its document against a base itself (null: none). */
export interface ChangeView {
  showChanges(base: string | null): void;
}

export interface ChangeTargets {
  /** Whose Typst files are tracked: every one has its own base. */
  project: Project;
  /** Marks the changed ranges of the current text of `path` in the preview (null: none). */
  preview(path: ProjectPath, ranges: { from: number; to: number }[] | null): void;
}

/** The label of the default base: each file's text as it was when the editor opened. */
const OPENED = 'opened';

/**
 * "Changes since …" for every Typst file of a project: each file's base
 * version, the one toggle button naming them (one label for all), and keeping
 * the views (`attach`) and the preview in step with both.
 *
 * Without a given base a file is compared with its text as opened, and a
 * file created since is new as a whole (toggle off at first). Bases belong to
 * the document, so they survive renames.
 * Hidden: when diffs are computed (only while changes are shown, and per
 * edited file).
 */
export class ChangeTracking {
  private readonly button: HTMLButtonElement;
  private label = OPENED;
  /** Each file's text as opened (or as a collaboration room first synced it). */
  private opened = new Map<TypstDocument, string>();
  /** The bases set per document; files without one compare with `fallback(path)`. */
  private bases = new Map<TypstDocument, string>();
  private fallback: (path: ProjectPath) => string = () => '';
  private shown = false;
  private readonly views = new Map<TypstDocument, ChangeView[]>();
  /** The paths the preview has (or had) changes for, to clear those of deleted and renamed files. */
  private readonly marked = new Set<ProjectPath>();
  private readonly unsubscribe: () => void;

  constructor(
    toolbar: HTMLElement,
    private readonly targets: ChangeTargets,
    base: Base | null = null,
  ) {
    this.takeOpened();
    this.unsubscribe = targets.project.onChange((change) => (change.kind === 'update' ? this.update(change.path) : this.render()));
    this.button = toolbar.ownerDocument.createElement('button');
    this.button.type = 'button';
    this.button.className = 'typst-editor__changes';
    this.button.addEventListener('click', () => this.show(!this.shown));
    toolbar.append(this.button);
    if (base) this.setBase(base);
    else this.render();
  }

  /** The editing views of `document` (created lazily): they show its changes from now on. */
  attach(document: TypstDocument, views: ChangeView[]): void {
    this.views.set(document, views);
    const path = this.targets.project.pathOf(document);
    const base = this.shown && path !== undefined ? this.baseOf(document, path) : null;
    for (const view of views) view.showChanges(base);
  }

  /**
   * Compares `path` (default: the main file) with `base` from now on and
   * shows the changes; the toggle names it. Null goes back to comparing every
   * file with its text as opened.
   */
  setBase(base: Base | null, path = this.targets.project.main): void {
    if (base === null) {
      this.bases = new Map(this.opened);
      this.fallback = () => '';
      this.label = OPENED;
    } else {
      const document = this.targets.project.document(path);
      if (document) this.bases.set(document, base.text);
      this.label = base.label;
      this.shown = true;
    }
    this.render();
  }

  /**
   * Compares every file with `base(path)` (null: the file is new since) from
   * now on, e.g. the last commit, and shows the changes.
   */
  setBases(label: string, base: (path: ProjectPath) => string | null): void {
    this.bases.clear();
    this.fallback = (path) => base(path) ?? '';
    this.label = label;
    this.shown = true;
    this.render();
  }

  /** Accepting a change moved the base of `document`; it is still the same version for the reader. */
  accept(document: TypstDocument, base: string): void {
    this.bases.set(document, base);
    this.render();
  }

  /**
   * The files' texts arrived only now (a collaboration room synced over the
   * local copy): "since opened" starts from them. Given bases stay.
   */
  resetOpened(): void {
    this.takeOpened();
    this.render();
  }

  show(shown: boolean): void {
    this.shown = shown;
    this.render();
  }

  destroy(): void {
    this.unsubscribe();
    this.button.remove();
  }

  private takeOpened(): void {
    this.opened = new Map(this.documents().map(([, document]) => [document, document.text]));
    if (this.label === OPENED) this.bases = new Map(this.opened);
  }

  private update(path: ProjectPath): void {
    const document = this.targets.project.document(path);
    if (this.shown && document) this.mark(path, this.ranges(document, path));
  }

  private render(): void {
    this.button.textContent = `Changes since ${this.label}`;
    this.button.title = this.shown ? 'Hide the changes' : `Show what changed since ${this.label}`;
    this.button.setAttribute('aria-pressed', String(this.shown));
    const documents = this.documents();
    this.forgetGone(documents);
    for (const [path, document] of documents) {
      const base = this.shown ? this.baseOf(document, path) : null;
      for (const view of this.views.get(document) ?? []) view.showChanges(base);
      this.mark(path, base === null ? null : this.ranges(document, path));
    }
  }

  /** Clears the preview's changes of paths that are gone (deleted, renamed) and drops the views of deleted files. */
  private forgetGone(documents: [ProjectPath, TypstDocument][]): void {
    const paths = new Set(documents.map(([path]) => path));
    for (const path of [...this.marked].filter((marked) => !paths.has(marked))) this.mark(path, null);
    const present = new Set(documents.map(([, document]) => document));
    for (const document of [...this.views.keys()].filter((viewed) => !present.has(viewed))) this.views.delete(document);
  }

  private mark(path: ProjectPath, ranges: { from: number; to: number }[] | null): void {
    if (ranges === null && !this.marked.has(path)) return;
    if (ranges === null) this.marked.delete(path);
    else this.marked.add(path);
    this.targets.preview(path, ranges);
  }

  private baseOf(document: TypstDocument, path: ProjectPath): string {
    return this.bases.get(document) ?? this.fallback(path);
  }

  private ranges(document: TypstDocument, path: ProjectPath): { from: number; to: number }[] {
    return diffTexts(this.baseOf(document, path), document.text).map((change) => ({ from: change.fromB, to: change.toB }));
  }

  private documents(): [ProjectPath, TypstDocument][] {
    const { project } = this.targets;
    return project.paths().flatMap((path): [ProjectPath, TypstDocument][] => {
      const document = project.document(path);
      return document ? [[path, document]] : [];
    });
  }
}
