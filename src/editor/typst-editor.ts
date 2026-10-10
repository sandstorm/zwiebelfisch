import { TypstDocument } from '../document/typst-document';
import { Preview } from '../preview/preview';
import { SourceView } from '../source-view/source-view';
import { VisualView } from '../visual-view/visual-view';
import proseMirrorStyles from 'prosemirror-view/style/prosemirror.css?inline';
import { DiagnosticsStatus } from './diagnostics-status';
import { summarizeDiagnostics } from './diagnostics-summary';
import { minimalChange } from './minimal-change';
import styles from './styles.css?inline';

const MAIN = '/main.typ';

export type EditorMode = 'visual' | 'source';

export interface TypstEditorOptions {
  /** Typst source of the main file. */
  source: string;
  /** The editing view shown first (default: visual). */
  mode?: EditorMode;
  /** Called whenever the source text changes. */
  onChange?(source: string): void;
}

export interface TypstEditor {
  /**
   * The current Typst source. Assigning replaces it as one minimal edit
   * (only the differing middle changes) and also triggers `onChange`.
   */
  source: string;
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

  const left = el(host.ownerDocument, 'typst-editor__left');
  const right = el(host.ownerDocument, 'typst-editor__right');
  host.classList.add('typst-editor');
  host.append(left, right);

  const status = new DiagnosticsStatus(host, (from, to) => source.reveal(from, to));
  const preview = new Preview(right, {
    onJump: (jump) => (mode === 'visual' ? visual : source).reveal(jump.from, jump.to),
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
  });
  let mode: EditorMode = options.mode ?? 'visual';
  panes.onSwitch((next) => (mode = next));
  panes.show(mode);

  const refresh = () => preview.update({ [MAIN]: document.text }, MAIN);
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
      const change = minimalChange(document.text, text);
      if (change) document.change([change], 'api');
    },
    destroy() {
      unsubscribe();
      source.destroy();
      visual.destroy();
      preview.destroy();
      status.destroy();
      host.classList.remove('typst-editor');
      left.remove();
      right.remove();
    },
  };
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
  style.textContent = proseMirrorStyles + styles;
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
    visual: panes.visual,
    source: panes.source,
    show,
    onSwitch(fn: (mode: EditorMode) => void) {
      listener = fn;
    },
  };
}
