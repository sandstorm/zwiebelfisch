// TypstStyleIndex: the read model of the custom styles a project declares, kept up to date, and how a document imports
// one. See styles in ../styles.ts.
import type { Disposable } from '../../../core/disposable/disposable';
import { EventEmitter, type Event } from '../../../core/event-emitter/event-emitter';
import { PathReference, ProjectPath } from '../../../core/paths/paths';
import type { FileChange, Project } from '../../../core/project/project';
import type { SourceOffset, TextChange, TypstDocument } from '../../../core/typst-document/typst-document';
import { calculateImportChange } from '../../../core/typst-syntax/typst-syntax';
import { scanStyles, type FoundStyle, type TypstStyle } from './discover';
import { STYLES_FILE } from './new-style';

/**
 * The styles of a project's Typst files. Every file is scanned once and again
 * whenever it changes; listeners hear about changes of the style list only,
 * not about every keystroke.
 */
export class TypstStyleIndex implements ProjectStyles {
  private readonly scans = new Map<ProjectPath, FoundStyle[]>();
  private readonly changed = new EventEmitter<void>();
  readonly onDidChange: Event<void> = this.changed.event;
  private list: TypstStyle[] = [];
  private readonly subscription: Disposable;

  constructor(private readonly project: Project) {
    for (const path of project.paths()) this.rescan(path);
    this.list = this.collect();
    this.subscription = project.onDidChangeFile((change) => this.update(change));
  }

  styles(): readonly TypstStyle[] {
    return this.list;
  }

  /** Imports are written relative to the document's (current) path, never into the file declaring the style. */
  calculateImportChange(document: TypstDocument, style: TypstStyle, use: SourceOffset): TextChange | null {
    const path = this.project.pathOf(document);
    if (!path || path === style.path) return null;
    const module = ProjectPath.referenceTo(path, style.path);
    const text = document.text;
    return calculateImportChange(text, {
      name: style.name,
      matches: (written) => ProjectPath.resolve(path, PathReference.of(written)) === style.path,
      // a blank line after it: an import right above `#note[..]` would make the two one (raw) block
      create: () => `#import "${module}": ${style.name}\n${/^\s*\n/.test(text) ? '' : '\n'}`,
      use,
    });
  }

  /** Where "New style…" adds a style: the file declaring the most styles (the first of equals), else `/styles.typ`. */
  homeFile(): ProjectPath {
    const counts = new Map<ProjectPath, number>();
    for (const style of this.list) counts.set(style.path, (counts.get(style.path) ?? 0) + 1);
    let home = STYLES_FILE;
    let most = 0;
    for (const [path, count] of counts) if (count > most) [home, most] = [path, count];
    return home;
  }

  /** Stops following the project; listeners hear nothing more. */
  dispose(): void {
    this.subscription.dispose();
    this.changed.dispose();
  }

  private update(change: FileChange): void {
    if (change.kind === 'rename') this.scans.delete(change.from);
    if (change.kind === 'delete') this.scans.delete(change.path);
    else this.rescan(change.path);
    this.publish();
  }

  /** Recollects the style list and tells the listeners if it changed. */
  private publish(): void {
    const list = this.collect();
    if (JSON.stringify(list) === JSON.stringify(this.list)) return;
    this.list = list;
    this.changed.fire();
  }

  private rescan(path: ProjectPath): void {
    const content = this.project.content(path);
    if (ProjectPath.isTypst(path) && typeof content === 'string') this.scans.set(path, scanStyles(content));
  }

  private collect(): TypstStyle[] {
    return this.project.paths().flatMap((path) => this.scans.get(path)?.map((style) => ({ ...style, path })) ?? []);
  }
}

/** What the Visual editor needs to know about the project's styles (see `TypstStyleIndex`). */
export interface ProjectStyles {
  /** The project's styles, by file (in the project's order) and then in source order. */
  styles(): readonly TypstStyle[];
  /** Whenever `styles()` changed. */
  readonly onDidChange: Event<void>;
  /**
   * The change to `document` that imports `style` for a use at offset `use`; null when nothing is needed (declared
   * in that file, imported already).
   */
  calculateImportChange(document: TypstDocument, style: TypstStyle, use: SourceOffset): TextChange | null;
}
