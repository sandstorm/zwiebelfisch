// FileNavigation: "← previous file" above and "next file →" below an included file, in the main file's reading
// order. See typst-editor.ts and core/project/reading-order.ts.
import { displayName } from '../core/project/project';

/**
 * Two link bars for the shown file: the file read before it (top) and after
 * it (bottom), as `neighbours` gives them. The host places `top` and `bottom`
 * around the editing view (see `EditingViews.setFrame`); a click opens that file.
 */
export class FileNavigation {
  readonly top: HTMLElement;
  readonly bottom: HTMLElement;

  constructor(doc: Document, private readonly open: (path: string) => void) {
    this.top = bar(doc, 'typst-editor__file-nav--previous');
    this.bottom = bar(doc, 'typst-editor__file-nav--next');
  }

  /** Shows the links for the shown file's neighbours; null (main file, not included, no file) hides both. */
  show(neighbours: { previous: string; next: string | null } | null): void {
    this.fill(this.top, neighbours?.previous ?? null, 'Previous');
    this.fill(this.bottom, neighbours?.next ?? null, 'Next');
  }

  private fill(element: HTMLElement, path: string | null, which: 'Previous' | 'Next'): void {
    element.hidden = path === null;
    if (path === null) return element.replaceChildren();
    const name = displayName(path);
    const button = element.ownerDocument.createElement('button');
    button.type = 'button';
    button.className = 'typst-editor__file-nav-link';
    button.textContent = which === 'Previous' ? `← ${name}` : `${name} →`;
    button.title = `${which} file: ${name}`;
    button.addEventListener('click', () => this.open(path));
    element.replaceChildren(button);
  }
}

function bar(doc: Document, modifier: string): HTMLElement {
  const element = doc.createElement('nav');
  element.className = `typst-editor__file-nav ${modifier}`;
  element.setAttribute('aria-label', modifier.endsWith('previous') ? 'Previous file' : 'Next file');
  element.hidden = true;
  return element;
}
