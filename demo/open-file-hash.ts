// The file shown in the demo's editor lives in the URL fragment (`#/chapters/introduction.typ`),
// so reloading or sharing the link opens the same file. See main.ts.
import type { TypstEditor } from '../src';

/** The project path in a URL fragment, or null (`#/a/b.typ` → `/a/b.typ`). */
export function pathFromHash(hash: string): string | null {
  const path = decodeURIComponent(hash.replace(/^#/, ''));
  return path.startsWith('/') && path.length > 1 ? path : null;
}

/** The URL fragment for a project path (`/a/b.typ` → `#/a/b.typ`). */
export function hashForPath(path: string): string {
  return `#${encodeURI(path)}`;
}

/**
 * Opens the file named in the fragment (now, or once it exists: in a
 * collaboration room the files arrive after connecting), follows fragment
 * edits, and writes the shown file back into the fragment without adding
 * history entries. Use as the editor's `onOpen` and `onFilesChange`.
 */
export class OpenFileHash {
  private editor: TypstEditor | null = null;
  private wanted: string | null;

  constructor(private readonly win: Window = window) {
    this.wanted = pathFromHash(win.location.hash);
    win.addEventListener('hashchange', () => {
      this.wanted = pathFromHash(win.location.hash);
      this.tryOpen();
    });
  }

  /** The editor to drive; opens the wanted file if it already exists. */
  attach(editor: TypstEditor): void {
    this.editor = editor;
    this.tryOpen();
  }

  /** The editor shows `path` (its `onOpen`). */
  opened(path: string): void {
    if (this.wanted !== null && path !== this.wanted && this.editor?.activeFile !== this.wanted) return;
    this.wanted = null;
    const hash = hashForPath(path);
    if (this.win.location.hash !== hash) this.win.history.replaceState(null, '', hash);
  }

  /** Files changed (its `onFilesChange`): the wanted file may exist now. */
  filesChanged(): void {
    this.tryOpen();
  }

  private tryOpen(): void {
    if (!this.editor || this.wanted === null) return;
    const wanted = this.wanted;
    this.editor.open(wanted);
    if (this.editor.activeFile === wanted) this.opened(wanted);
  }
}
