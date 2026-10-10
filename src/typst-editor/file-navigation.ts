// FileNavigation: "← previous file" and "next file →" above and below an included file, in the main file's
// reading order. See typst-editor.ts and core/project/reading-order.ts.
import { ProjectPath } from '../core/paths/paths';

/**
 * Two identical link bars for the shown file, one for its start (`top`) and
 * one for its end (`bottom`): each links the file read before it (left) and
 * after it (right), as `neighbours` gives them. The host places them around
 * the editing view (see `EditingViews.setFrame`); a click opens that file.
 */
export class FileNavigation {
  readonly top: HTMLElement;
  readonly bottom: HTMLElement;

  constructor(doc: Document, private readonly open: (path: ProjectPath) => void) {
    this.top = bar(doc, 'typst-editor__file-nav--top', 'Files before and after (top)');
    this.bottom = bar(doc, 'typst-editor__file-nav--bottom', 'Files before and after (bottom)');
  }

  /** Shows the links for the shown file's neighbours; null (main file, not included, no file) hides both bars. */
  show(neighbours: { previous: ProjectPath; next: ProjectPath | null } | null): void {
    for (const element of [this.top, this.bottom]) {
      element.hidden = neighbours === null;
      element.replaceChildren(
        ...(neighbours ? [this.link(neighbours.previous, 'Previous'), ...(neighbours.next ? [this.link(neighbours.next, 'Next')] : [])] : []),
      );
    }
  }

  private link(path: ProjectPath, which: 'Previous' | 'Next'): HTMLButtonElement {
    const name = ProjectPath.displayName(path);
    const button = this.top.ownerDocument.createElement('button');
    button.type = 'button';
    button.className = `typst-editor__file-nav-link typst-editor__file-nav-link--${which.toLowerCase()}`;
    button.textContent = which === 'Previous' ? `← ${name}` : `${name} →`;
    button.title = `${which} file: ${name}`;
    button.addEventListener('click', () => this.open(path));
    return button;
  }
}

function bar(doc: Document, modifier: string, label: string): HTMLElement {
  const element = doc.createElement('nav');
  element.className = `typst-editor__file-nav ${modifier}`;
  element.setAttribute('aria-label', label);
  element.hidden = true;
  return element;
}
