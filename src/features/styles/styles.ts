// StyleIndex: the paragraph and text styles a project declares (`/// @style …`), kept up to date, and how a
// document imports one. Entry of features/styles/. See ARCHITECTURE.md, "Custom styles".
import { type FileChange, importChange, type Project, referencePath, resolvePath } from '../../core/project/project';
import type { TextChange, TypstDocument } from '../../core/typst-document/typst-document';
import { scanStyles, type FoundStyle, type Style } from './discover';

export { discoverStyles, scanStyles, type Style, type StyleKind } from './discover';
export { newStyle, STYLES_FILE } from './new-style';

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
  importChange(text: string, style: Style, use: number): TextChange | null;
  /** "New style…" in the style menu: adds a style to start from and shows it. Absent: no such entry. */
  create?(): void;
}

/**
 * The styles of a project's Typst files. Every file is scanned once and again
 * whenever it changes; listeners hear about changes of the style list only,
 * not about every keystroke.
 */
export class StyleIndex {
  private readonly scans = new Map<string, FoundStyle[]>();
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

  /** The styles as `document` sees them: imports are written relative to its (current) path. */
  forDocument(document: TypstDocument): DocumentStyles {
    return {
      styles: () => this.list,
      onChange: (listener) => this.onChange(listener),
      importChange: (text, style, use) => {
        const path = this.project.pathOf(document);
        if (!path || path === style.path) return null;
        const module = referencePath(path, style.path);
        return importChange(text, {
          name: style.name,
          matches: (written) => resolvePath(path, written) === style.path,
          // a blank line after it: an import right above `#note[..]` would make the two one (raw) block
          create: () => `#import "${module}": ${style.name}\n${/^\s*\n/.test(text) ? '' : '\n'}`,
          use,
        });
      },
    };
  }

  /** Rescans every file: after `Project.replace`, which tells no listener. */
  refresh(): void {
    this.scans.clear();
    for (const path of this.project.paths()) this.rescan(path);
    this.publish();
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

  private rescan(path: string): void {
    const content = this.project.content(path);
    if (path.endsWith('.typ') && typeof content === 'string') this.scans.set(path, scanStyles(content));
  }

  private collect(): Style[] {
    return this.project.paths().flatMap((path) => this.scans.get(path)?.map((style) => ({ ...style, path })) ?? []);
  }
}
