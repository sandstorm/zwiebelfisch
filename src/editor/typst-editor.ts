import { TypstDocument } from '../document/typst-document';
import { Preview } from '../preview/preview';
import { SourceView } from '../source-view/source-view';
import styles from './styles.css?inline';

const MAIN = '/main.typ';

export interface TypstEditorOptions {
  /** Typst source of the main file. */
  source: string;
  /** Called whenever the source text changes. */
  onChange?(source: string): void;
}

export interface TypstEditor {
  /** The current Typst source. */
  readonly source: string;
  destroy(): void;
}

/**
 * Mounts the editor widget into `host`: an editing view on the left and the
 * live preview on the right. Clicking the preview reveals the source; moving
 * the cursor reveals the spot in the preview.
 */
export function createTypstEditor(host: HTMLElement, options: TypstEditorOptions): TypstEditor {
  injectStyles(host.ownerDocument);
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

function injectStyles(doc: Document): void {
  if (doc.getElementById('typst-editor-styles')) return;
  const style = doc.createElement('style');
  style.id = 'typst-editor-styles';
  style.textContent = styles;
  doc.head.append(style);
}
