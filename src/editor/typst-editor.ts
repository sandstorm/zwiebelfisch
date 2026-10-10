import { TypstDocument } from '../document/typst-document';
import { Preview } from '../preview/preview';
import type { FileContent } from '../preview/project-files';
import { SourceView } from '../source-view/source-view';
import { VisualView } from '../visual-view/visual-view';
import proseMirrorStyles from '../visual-view/prosemirror.css?inline';
import { ChangeTracking } from './change-tracking';
import changeStyles from './changes.css?inline';
import { DiagnosticsStatus } from './diagnostics-status';
import { summarizeDiagnostics } from './diagnostics-summary';
import styles from './styles.css?inline';

export type EditorMode = 'visual' | 'source';

/** Other project files by absolute path (`/chapter.typ`, `/img/logo.png`): source text or bytes. */
export type ProjectFiles = Record<string, FileContent>;

export interface TypstEditorOptions {
  /** Typst source of the main file — the one that is edited. */
  source: string;
  /** Path of the main file (default `/main.typ`). */
  main?: string;
  /**
   * The project's other files, which the main file can `#include`, `#import`
   * or load (`image(…)`). Not editable here. `@preview` packages need no
   * entry: they are downloaded from packages.typst.org on first import.
   */
  files?: ProjectFiles;
  /** The editing view shown first (default: visual). */
  mode?: EditorMode;
  /** Called whenever the source text changes. */
  onChange?(source: string): void;
  /**
   * An earlier version of the source (last saved, last commit) to show the
   * changes against: inline diff in the Source view, track changes in the
   * Visual view, change bars in the preview. See also `setBase`.
   */
  base?: string;
}

export interface TypstEditor {
  /**
   * The current Typst source. Assigning replaces it as one minimal edit
   * (only the differing middle changes) and also triggers `onChange`.
   */
  source: string;
  /** The other project files; assigning replaces them all and recompiles. */
  files: ProjectFiles;
  /**
   * Shows the changes against `base` (an earlier source) from now on, or
   * none for null. A "Show changes" button toggles them while a base is set.
   */
  setBase(base: string | null): void;
  destroy(): void;
}

/**
 * Mounts the editor widget into `host`: an editing view on the left and the
 * live preview on the right. Clicking the preview reveals the source; moving
 * the cursor reveals the spot in the preview. Compiler errors are underlined in
 * the source and counted in a status bar that jumps to the first one.
 *
 * Styles go into the root node `host` is attached to: `document.head`, or the
 * shadow root when `host` lives in one. Attach `host` before calling this.
 */
export function createTypstEditor(host: HTMLElement, options: TypstEditorOptions): TypstEditor {
  injectStyles(host);
  const document = new TypstDocument(options.source);
  const MAIN = options.main ?? '/main.typ';
  let files = options.files ?? {};

  const { left, right, remove } = createLayout(host);

  const status = new DiagnosticsStatus(host, (from, to) => source.reveal(from, to));
  const preview = new Preview(right, {
    onJump: (jump) => jump.path === MAIN && (mode === 'visual' ? visual : source).reveal(jump.from, jump.to),
    onDiagnostics: (diagnostics) => {
      const summary = summarizeDiagnostics(diagnostics, MAIN);
      source.setDiagnostics(summary.inMain);
      status.show(summary);
    },
  });
  const panes = createPanes(left);
  const visual = new VisualView(panes.visual, document);
  const source = new SourceView(panes.source, document, {
    onCursor: (offset) => void preview.reveal(MAIN, offset),
    onBaseChange: (base) => changes.setBase(base),
  });
  const showInPreview = (ranges: { from: number; to: number }[] | null) => preview.showChanges(MAIN, ranges);
  const changes = new ChangeTracking(panes.tabs, { document, views: [source, visual], preview: showInPreview }, options.base);
  let mode: EditorMode = options.mode ?? 'visual';
  panes.onSwitch((next) => (mode = next));
  panes.show(mode);

  const refresh = () => preview.update({ ...files, [MAIN]: document.text }, MAIN);
  const unsubscribe = document.onChange(() => {
    refresh();
    options.onChange?.(document.text);
  });
  refresh();

  return {
    get source() {
      return document.text;
    },
    set source(text: string) {
      document.setText(text, 'api');
    },
    get files() {
      return files;
    },
    set files(next: ProjectFiles) {
      files = next;
      refresh();
    },
    setBase: (base) => changes.setBase(base),
    destroy() {
      unsubscribe();
      changes.destroy();
      source.destroy();
      visual.destroy();
      preview.destroy();
      status.destroy();
      remove();
    },
  };
}

/** The two columns of the widget: editing views left, preview right. */
function createLayout(host: HTMLElement) {
  const left = el(host.ownerDocument, 'typst-editor__left');
  const right = el(host.ownerDocument, 'typst-editor__right');
  host.classList.add('typst-editor');
  host.append(left, right);
  const remove = () => {
    host.classList.remove('typst-editor');
    left.remove();
    right.remove();
  };
  return { left, right, remove };
}

function el(doc: Document, className: string): HTMLElement {
  const element = doc.createElement('div');
  element.className = className;
  return element;
}

const STYLE_ID = 'typst-editor-styles';

function injectStyles(host: HTMLElement): void {
  const root = host.getRootNode();
  const target = root instanceof ShadowRoot ? root : host.ownerDocument.head;
  if (target.querySelector(`#${STYLE_ID}`)) return;
  const style = host.ownerDocument.createElement('style');
  style.id = STYLE_ID;
  style.textContent = proseMirrorStyles + styles + changeStyles;
  target.append(style);
}

/** The Visual/Source tab bar and the two panes it switches between. */
function createPanes(left: HTMLElement) {
  const doc = left.ownerDocument;
  const tabs = el(doc, 'typst-editor__tabs');
  tabs.setAttribute('role', 'tablist');
  const panes = { visual: el(doc, 'typst-editor__pane'), source: el(doc, 'typst-editor__pane') };
  const buttons = (['visual', 'source'] as const).map((mode) => {
    const button = doc.createElement('button');
    button.className = 'typst-editor__tab';
    button.setAttribute('role', 'tab');
    button.textContent = mode === 'visual' ? 'Visual' : 'Source';
    button.dataset.mode = mode;
    tabs.append(button);
    return button;
  });
  left.append(tabs, panes.visual, panes.source);
  let listener: (mode: EditorMode) => void = () => {};
  const show = (mode: EditorMode) => {
    for (const button of buttons) button.setAttribute('aria-selected', String(button.dataset.mode === mode));
    panes.visual.hidden = mode !== 'visual';
    panes.source.hidden = mode !== 'source';
    listener(mode);
  };
  tabs.addEventListener('click', (event) => {
    const mode = (event.target as HTMLElement).closest<HTMLElement>('[data-mode]')?.dataset.mode;
    if (mode === 'visual' || mode === 'source') show(mode);
  });
  return {
    tabs,
    visual: panes.visual,
    source: panes.source,
    show,
    onSwitch(fn: (mode: EditorMode) => void) {
      listener = fn;
    },
  };
}
