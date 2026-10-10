import { TypstDocument } from '../document/typst-document';
import { Preview } from '../preview/preview';
import { SourceView } from '../source-view/source-view';
import { minimalChange } from './minimal-change';
import styles from './styles.css?inline';

const MAIN = '/main.typ';

export interface TypstEditorOptions {
  /** Typst source of the main file. */
  source: string;
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
 * the cursor reveals the spot in the preview.
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

  const preview = new Preview(right, {
    onJump: (jump) => source.reveal(jump.from, jump.to),
  });
  const source = new SourceView(left, document, {
    onCursor: (offset) => void preview.reveal(MAIN, offset),
  });

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
      preview.destroy();
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
  style.textContent = styles;
  target.append(style);
}
