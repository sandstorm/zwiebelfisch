// LabelIndex: the read model of a project's labels and the references to them, kept up to date. See model.ts.
import type { Disposable } from '../../../core/disposable/disposable';
import { EventEmitter, type Event } from '../../../core/event-emitter/event-emitter';
import type { ProjectPath } from '../../../core/paths/paths';
import type { FileChange, Project } from '../../../core/project/project';
import type { TypstDocument } from '../../../core/typst-document/typst-document';
import { calculateReferenceRenames, scanBibliography, scanTypst, type FoundLabel, type LabelKind, type Scan } from './scan';

/** A label of the project: its name, what it labels (null: something else), that element's title, and its file. */
export interface LabelInfo extends FoundLabel {
  kind: LabelKind | null;
  path: ProjectPath;
}

/** What the Visual view needs to know about the project's labels (see `LabelIndex`). */
export interface ProjectLabels {
  /** Every label of the project, by file (in the project's order) and then in source order. */
  labels(): readonly LabelInfo[];
  /** How many references (`@name`) to label `name` the project has. */
  referenceCount(name: string): number;
  /** Renames the references to `from` in every Typst file except `except`, one change per file. */
  renameReferences(from: string, to: string, except?: TypstDocument): void;
  /** Whenever `labels()` changed. */
  readonly onDidChange: Event<void>;
}

/** The origin of the changes `renameReferences` makes. */
const RENAME_ORIGIN = 'rename-references';

/**
 * The labels of a project's files — Typst labels (`<intro>`, with what they
 * label: a heading and its text, a figure and its caption, …) and the keys of
 * `.bib` bibliographies — and how often each is referenced. Every file is
 * scanned once and again whenever it changes; listeners hear about changes
 * of the label list only, not about every keystroke.
 */
export class LabelIndex implements ProjectLabels {
  private readonly scans = new Map<ProjectPath, Scan>();
  private readonly changed = new EventEmitter<void>();
  readonly onDidChange: Event<void> = this.changed.event;
  private list: LabelInfo[] = [];
  private readonly subscription: Disposable;

  constructor(private readonly project: Project) {
    for (const path of project.paths()) this.rescan(path);
    this.list = this.collect();
    this.subscription = project.onDidChangeFile((change) => this.update(change));
  }

  labels(): readonly LabelInfo[] {
    return this.list;
  }

  referenceCount(name: string): number {
    let count = 0;
    for (const scan of this.scans.values()) count += scan.references.get(name) ?? 0;
    return count;
  }

  renameReferences(from: string, to: string, except?: TypstDocument): void {
    for (const [path, scan] of this.scans) {
      const document = this.project.document(path);
      if (!document || document === except || !scan.references.has(from)) continue;
      document.change(calculateReferenceRenames(document.text, from, to), RENAME_ORIGIN);
    }
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

  /** Recollects the label list and tells the listeners if it changed. */
  private publish(): void {
    const list = this.collect();
    if (JSON.stringify(list) === JSON.stringify(this.list)) return;
    this.list = list;
    this.changed.fire();
  }

  private rescan(path: ProjectPath): void {
    const content = this.project.content(path);
    const text = typeof content === 'string' ? content : content && new TextDecoder().decode(content);
    if (path.endsWith('.typ') && typeof content === 'string') this.scans.set(path, scanTypst(content));
    else if (path.endsWith('.bib') && text !== undefined) this.scans.set(path, scanBibliography(text));
  }

  private collect(): LabelInfo[] {
    return this.project.paths().flatMap((path) => this.scans.get(path)?.labels.map((label) => ({ ...label, path })) ?? []);
  }
}
