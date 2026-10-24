// See WindowApi in ../window.ts.
import { Disposable } from '../../../core/disposable/disposable';
import type { TitleBarPlacement } from '../window';

/**
 * The items extensions put into the title bar (`window.registerTitleBarItem`), in three sides: `left` from its start,
 * `center` in the middle, `right` at its end; within a side the higher `priority` further left (default 0), equal
 * priorities in registration order. The bar is hidden while it has no item.
 *
 * @internal Extensions add to it through `window.registerTitleBarItem`.
 */
export class TitleBar {
  readonly #bar: HTMLElement;
  readonly #sides: Record<TitleBarPlacement['alignment'], { element: HTMLElement; entries: Entry[] }>;

  /** Fills `bar` (the layout's title bar region). */
  constructor(bar: HTMLElement) {
    this.#bar = bar;
    const side = (alignment: string) => {
      const element = bar.ownerDocument.createElement('div');
      element.className = `zwf-editor__title-bar-${alignment}`;
      return { element, entries: [] as Entry[] };
    };
    this.#sides = { left: side('left'), center: side('center'), right: side('right') };
    bar.append(this.#sides.left.element, this.#sides.center.element, this.#sides.right.element);
    this.#update();
  }

  /** Shows `element` where `placement` says, until disposed. */
  add(element: HTMLElement, placement: TitleBarPlacement): Disposable {
    const side = this.#sides[placement.alignment];
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
    this.#bar.hidden = Object.values(this.#sides).every((side) => side.entries.length === 0);
  }
}

interface Entry {
  readonly element: HTMLElement;
  readonly priority: number;
}
