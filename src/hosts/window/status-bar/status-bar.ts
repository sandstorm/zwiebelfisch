// StatusBar. See window.ts and docs/30_architecture/07_workbench.typ.
import { Disposable } from '../../../core/disposable/disposable';
import type { StatusBarPlacement } from '../window';

/**
 * The status bar's items in two sides, as in VS Code: the `left` ones from its start, the `right` ones at its end;
 * within a side the higher `priority` further left (default 0), equal priorities in registration order. The bar is
 * hidden while it has no item.
 *
 * The items extensions put into the status bar (`window.registerStatusBarItem`), placed as VS Code places its
 * StatusBarItems.
 */
export class StatusBar {
  readonly #bar: HTMLElement;
  readonly #sides: Record<StatusBarPlacement['alignment'], { element: HTMLElement; entries: Entry[] }>;

  /** Fills `bar` (the layout's status bar region). */
  constructor(bar: HTMLElement) {
    this.#bar = bar;
    const side = (alignment: string) => {
      const element = bar.ownerDocument.createElement('div');
      element.className = `typst-editor__status-bar-${alignment}`;
      return { element, entries: [] as Entry[] };
    };
    this.#sides = { left: side('left'), right: side('right') };
    bar.append(this.#sides.left.element, this.#sides.right.element);
    this.#update();
  }

  /** Shows `element` where `placement` says, until disposed. */
  add(element: HTMLElement, placement: StatusBarPlacement): Disposable {
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
    this.#bar.hidden = this.#sides.left.entries.length + this.#sides.right.entries.length === 0;
  }
}

interface Entry {
  readonly element: HTMLElement;
  readonly priority: number;
}
