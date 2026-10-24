// See WindowApi in ../window.ts.
import { Disposable } from '../../../core/disposable/disposable';

/**
 * A bar of the items extensions put into it, in the sides `alignments` names (each a box of class
 * `<bar's class>-<alignment>`, in that order); within a side the higher `priority` further left (default 0), equal
 * priorities in registration order, as VS Code's status bar. The bar is hidden while it has no item.
 *
 * Callers:
 * - the status bar (`window.registerStatusBarItem`: `left`, `right`)
 * - the title bar (`window.registerTitleBarItem`: `left`, `center`, `right`)
 *
 * @internal Extensions add to it through the window.
 */
export class ItemBar<A extends string> {
  readonly #bar: HTMLElement;
  readonly #sides: Map<A, { element: HTMLElement; entries: Entry[] }>;

  /** Fills `bar` (a region of the layout) with a box per alignment. */
  constructor(bar: HTMLElement, alignments: readonly A[]) {
    this.#bar = bar;
    this.#sides = new Map(
      alignments.map((alignment) => {
        const element = bar.ownerDocument.createElement('div');
        element.className = `${bar.className}-${alignment}`;
        bar.append(element);
        return [alignment, { element, entries: [] as Entry[] }];
      }),
    );
    this.#update();
  }

  /** Shows `element` where `placement` says, until disposed. */
  add(element: HTMLElement, placement: { readonly alignment: A; readonly priority?: number }): Disposable {
    const side = this.#sides.get(placement.alignment)!;
    const entry = { element, priority: placement.priority ?? 0 };
    // the sort is stable: equal priorities stay in registration order
    side.entries = [...side.entries, entry].sort((a, b) => b.priority - a.priority);
    side.element.append(...side.entries.map((each) => each.element));
    this.#update();
    return new Disposable(() => {
      if (!side.entries.includes(entry)) return;
      side.entries = side.entries.filter((each) => each !== entry);
      element.remove();
      this.#update();
    });
  }

  #update(): void {
    this.#bar.hidden = [...this.#sides.values()].every((side) => side.entries.length === 0);
  }
}

interface Entry {
  readonly element: HTMLElement;
  readonly priority: number;
}
