// The demo's extension keeping the shown file and the cursor's line in the URL fragment. See main.ts.
import { ProjectPath, SourceOffset, type Extension, type WindowApi } from '../src';

/**
 * The shown file and the cursor's line in the URL fragment (`#/chapters/intro.typ:12`, the line 1-based like GitHub's
 * `#L12` or VS Code's `path:line`), so reloading or sharing the link opens the same place. Written against the public
 * extension API only, as any host could.
 *
 * On load and on every edit of the fragment it opens that file with the cursor at the start of the line, scrolled into
 * view, in whichever editor shows the file (other files just open). In a collaboration room the files and their text
 * arrive after connecting, so a file or line that is not there waits until it is, or until the user goes elsewhere;
 * meanwhile the fragment names the shown file. While the user works, the fragment follows (history.replaceState: no
 * history entries): at once for another file, after a pause for the cursor.
 */
export function openFileHash(): Extension {
  return {
    id: 'open-file-hash',
    activate({ project, window, workbench, subscriptions }) {
      let pending = locationFromHash(location.hash);
      let shown = window.activeFile;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const show = () => {
        clearTimeout(timer);
        const hash = hashForLocation(shownLocation(window));
        if (location.hash !== hash) history.replaceState(history.state, '', hash);
      };
      /** Opens the pending location once its file (and line) is there. */
      const restore = () => {
        if (!pending) return;
        const { path, line } = pending;
        if (!project.has(path)) return show();
        const document = project.document(path);
        const start = document && line !== null ? lineStart(document.text, line) : undefined;
        if (start === null) {
          if (window.activeFile !== path) workbench.open(path);
          return;
        }
        pending = null;
        workbench.open(path, start === undefined ? {} : { selection: { from: start, to: start } });
      };
      const followHash = () => {
        pending = locationFromHash(location.hash);
        if (pending) restore();
        else show();
      };

      // after the workbench showed the main file (it does so once every extension is activated)
      queueMicrotask(restore);
      addEventListener('hashchange', followHash);
      subscriptions.push(
        window.onDidChangeActiveFile((path) => {
          // the user went to another file (not the workbench showing the same one again)
          if (pending && path !== pending.path && path !== shown) pending = null;
          shown = path;
          if (!pending) show();
        }),
        window.onDidChangeTextEditorSelection(({ textEditor }) => {
          if (textEditor !== window.activeTextEditor) return;
          if (pending && workbench.isEditorFocused()) pending = null;
          if (pending) return restore();
          clearTimeout(timer);
          timer = setTimeout(show, 300);
        }),
        project.onDidChangeFile((change) => {
          if (change.kind !== 'update') restore();
        }),
        {
          dispose: () => {
            pending = null;
            clearTimeout(timer);
            removeEventListener('hashchange', followHash);
          },
        },
      );
    },
  };
}

/** A place in the project: a file, and in a Typst file the cursor's line (1-based). */
export interface FileLocation {
  readonly path: ProjectPath;
  readonly line: number | null;
}

/** The location in a URL fragment, or null (`#/a/b.typ:12` → `/a/b.typ`, line 12). */
export function locationFromHash(hash: string): FileLocation | null {
  const [, written = '', line] = /^(.*?)(?::(\d+))?$/.exec(safeDecode(hash.replace(/^#/, ''))) ?? [];
  const path = ProjectPath.parse(written);
  return path && { path, line: Number(line) >= 1 ? Number(line) : null };
}

/** The URL fragment for a location (`/a b.typ`, line 3 → `#/a%20b.typ:3`). */
export function hashForLocation({ path, line }: FileLocation): string {
  return `#${encodeURI(path)}${line === null ? '' : `:${line}`}`;
}

/** The shown file, and in a Typst file the line of the cursor (the start of a selection). */
function shownLocation(window: WindowApi): FileLocation {
  const editor = window.activeTextEditor;
  const line = editor ? editor.document.text.slice(0, editor.selection.from).split('\n').length : null;
  return { path: window.activeFile, line };
}

/** The offset where 1-based `line` starts in `text`; null when the text has fewer lines. */
function lineStart(text: string, line: number): SourceOffset | null {
  let offset = 0;
  for (let current = 1; current < line; current++) {
    offset = text.indexOf('\n', offset) + 1;
    if (offset === 0) return null;
  }
  return SourceOffset.of(offset);
}

/** `text` URL-decoded; as it is when it is not valid (a stray `%`). */
function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}
