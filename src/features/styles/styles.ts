// The styles extension and its StyleIndex: the paragraph and text styles a project declares (`/// @style …`), kept
// up to date, and how a document imports one. Entry of features/styles/. See ARCHITECTURE.md, "Custom styles".
import { Disposable } from '../../core/disposable/disposable';
import { type FileChange, type Project } from '../../core/project/project';
import { PathReference, ProjectPath } from '../../core/paths/paths';
import { calculateImportChange, type TextChange, type TypstDocument } from '../../core/typst-document/typst-document';
import type { TypstExtension, Workbench } from '../../hosts/workbench/workbench';
import { scanStyles, type FoundStyle, type Style } from './discover';
import { newStyle, STYLES_FILE } from './new-style';

export { discoverStyles, scanStyles, type Style, type StyleKind } from './discover';
export { newStyle, STYLES_FILE } from './new-style';

declare module '../../hosts/workbench/workbench' {
  interface ServiceRegistry {
    /** The custom styles the project declares (the styles extension). */
    styles: StyleIndex;
  }
}

/**
 * Keeps the project's custom styles indexed (the `styles` service); every document's Visual view shows and applies
 * them and offers "New style…".
 */
export function styles(): TypstExtension {
  return {
    id: 'styles',
    activate({ project, workbench, services, visualView, subscriptions }) {
      const index = new StyleIndex(project);
      subscriptions.push(
        new Disposable(() => index.destroy()),
        services.provide('styles', index),
        visualView.registerDocumentOptions((document) => ({
          styles: { ...index.forDocument(document), create: () => void addNewStyle(index, project, workbench) },
        })),
      );
    },
  };
}

/** What the Visual view of one document needs: the project's styles, and how to make one usable there. */
export interface DocumentStyles {
  /** The project's styles, by file (in the project's order) and then in source order. */
  styles(): readonly Style[];
  /** Calls `listener` whenever `styles()` changed; returns the unsubscribe function. */
  onChange(listener: () => void): () => void;
  /**
   * The edit to this document's `text` that imports `style` for a use at
   * `use`; null when nothing is needed (declared in this file, imported already).
   */
  calculateImportChange(text: string, style: Style, use: number): TextChange | null;
  /** "New style…" in the style menu: adds a style to start from and shows it. Absent: no such entry. */
  create?(): void;
}

/**
 * The styles of a project's Typst files. Every file is scanned once and again
 * whenever it changes; listeners hear about changes of the style list only,
 * not about every keystroke.
 */
export class StyleIndex {
  private readonly scans = new Map<ProjectPath, FoundStyle[]>();
  private readonly listeners = new Set<() => void>();
  private list: Style[] = [];
  private readonly unsubscribe: () => void;

  constructor(private readonly project: Project) {
    for (const path of project.paths()) this.rescan(path);
    this.list = this.collect();
    this.unsubscribe = project.onChange((change) => this.changed(change));
  }

  styles(): readonly Style[] {
    return this.list;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
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

  /** The styles as `document` sees them: imports are written relative to its (current) path. */
  forDocument(document: TypstDocument): DocumentStyles {
    return {
      styles: () => this.list,
      onChange: (listener) => this.onChange(listener),
      calculateImportChange: (text, style, use) => {
        const path = this.project.pathOf(document);
        if (!path || path === style.path) return null;
        const module = ProjectPath.referenceTo(path, style.path);
        return calculateImportChange(text, {
          name: style.name,
          matches: (written) => ProjectPath.resolve(path, PathReference.of(written)) === style.path,
          // a blank line after it: an import right above `#note[..]` would make the two one (raw) block
          create: () => `#import "${module}": ${style.name}\n${/^\s*\n/.test(text) ? '' : '\n'}`,
          use,
        });
      },
    };
  }

  destroy(): void {
    this.unsubscribe();
    this.listeners.clear();
  }

  private changed(change: FileChange): void {
    if (change.kind === 'rename') this.scans.delete(change.from);
    if (change.kind === 'delete') this.scans.delete(change.path);
    else this.rescan(change.path);
    this.publish();
  }

  private publish(): void {
    const list = this.collect();
    if (JSON.stringify(list) === JSON.stringify(this.list)) return;
    this.list = list;
    for (const listener of this.listeners) listener();
  }

  private rescan(path: ProjectPath): void {
    const content = this.project.content(path);
    if (path.endsWith('.typ') && typeof content === 'string') this.scans.set(path, scanStyles(content));
  }

  private collect(): Style[] {
    return this.project.paths().flatMap((path) => this.scans.get(path)?.map((style) => ({ ...style, path })) ?? []);
  }
}

/**
 * "New style…": appends a paragraph style to start from to the file holding most styles (else
 * `/styles.typ`, created when missing) and shows it in the Source view.
 */
async function addNewStyle(index: StyleIndex, project: Project, workbench: Workbench): Promise<void> {
  const path = index.homeFile();
  const file = project.document(path);
  const added = newStyle(file?.text ?? '');
  if (file) file.change([{ from: file.text.length, to: file.text.length, insert: added.text.slice(file.text.length) }], 'new-style');
  else if ((await workbench.applyChange({ kind: 'create', path, content: added.text })) !== null) return;
  workbench.open(path, { selection: { from: added.from, to: added.to }, mode: 'source' });
}
