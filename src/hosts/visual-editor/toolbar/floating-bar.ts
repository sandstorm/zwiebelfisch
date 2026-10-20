// See Toolbar in toolbar.ts.
import type { Anchor } from '../visual-editor';

/**
 * A small toolbar floating just above an anchor in the Visual editor's text (the selection, a table): a floating bar's
 * buttons (`registerFloatingBar`).
 *
 * It sits in `container` (the scrolling text column), so it scrolls with the text, centred over the anchor and kept
 * inside the container. Mouse presses on it keep the focus and the selection in the text.
 *
 * @internal Extensions get one through `visualEditor.registerFloatingBar`.
 */
export class FloatingBarView {
  readonly element: HTMLElement;

  constructor(
    private readonly container: HTMLElement,
    label: string,
  ) {
    const doc = container.ownerDocument;
    this.element = doc.createElement('div');
    this.element.className = 'zwf-floating-bar';
    this.element.setAttribute('role', 'toolbar');
    this.element.setAttribute('aria-label', label);
    this.element.hidden = true;
    this.element.addEventListener('mousedown', (event) => {
      if ((event.target as HTMLElement).closest('button')) event.preventDefault();
    });
    container.append(this.element);
  }

  /** Puts `entries` in the bar, unless they are the ones there. */
  setEntries(entries: readonly HTMLElement[]): void {
    const shown = this.element.children;
    if (shown.length !== entries.length || entries.some((entry, i) => entry !== shown[i])) this.element.replaceChildren(...entries);
  }

  show(anchor: Anchor): void {
    this.element.hidden = anchor === null;
    if (!anchor) return;
    const box = this.container.getBoundingClientRect();
    const width = this.element.offsetWidth;
    const centre = (anchor.left + anchor.right) / 2 - box.left;
    const left = Math.max(0, Math.min(centre - width / 2, this.container.clientWidth - width));
    this.element.style.left = `${left}px`;
    // the bar's bottom 6px above the anchor (translateY(-100%) in CSS: no height to measure)
    this.element.style.top = `${anchor.top - box.top - 6}px`;
  }

  dispose(): void {
    this.element.remove();
  }
}
