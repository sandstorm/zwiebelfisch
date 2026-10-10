// FloatingBar: a small toolbar floating above something in the text (the selection, the table). See toolbar.ts.

/** Where a floating bar points: a viewport rectangle (e.g. a selection's or a table's), or nothing (hidden). */
export type Anchor = { top: number; left: number; right: number } | null;

/**
 * A `role="toolbar"` bar positioned just above an anchor in the Visual
 * view's text: placed in `container` (the scrolling text column, which is
 * `position: relative`), so it scrolls with the text. `show(anchor)` places it
 * centred over the anchor and kept inside the container; null hides it.
 * Mouse presses on it keep the focus (and selection) in the text.
 */
export class FloatingBar {
  readonly element: HTMLElement;

  constructor(
    private readonly container: HTMLElement,
    label: string,
    buttons: HTMLElement[],
  ) {
    const doc = container.ownerDocument;
    this.element = doc.createElement('div');
    this.element.className = 'typst-floating-bar';
    this.element.setAttribute('role', 'toolbar');
    this.element.setAttribute('aria-label', label);
    this.element.hidden = true;
    this.element.addEventListener('mousedown', (event) => {
      if ((event.target as HTMLElement).closest('button')) event.preventDefault();
    });
    this.element.append(...buttons);
    container.append(this.element);
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

  destroy(): void {
    this.element.remove();
  }
}
