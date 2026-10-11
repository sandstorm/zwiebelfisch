// Menus. See workbench.ts.
import { Disposable } from '../../../core/disposable/disposable';
import { EventEmitter } from '../../../core/event-emitter/event-emitter';
import type { MenuContext, MenuItem } from '../workbench';

/**
 * Every menu's registered entries. A menu is only an id: whoever shows it (the tab bar here, an extension's side panel or editor)
 * asks for the entries that apply in its context, in VS Code's order: group `navigation` first, the other groups by
 * name, within a group by `order`, then registration order.
 *
 * The entries extensions register into menus by id (`registerMenuItem`), as whoever shows a menu reads them
 * (`getMenuItems`).
 */
export class Menus {
  readonly #items = new Map<string, MenuItem[]>();
  readonly #changed = new EventEmitter<string>();
  readonly onDidChange = this.#changed.event;

  register(menuId: string, item: MenuItem): Disposable {
    const items = this.#items.get(menuId) ?? [];
    this.#items.set(menuId, [...items, item]);
    this.#changed.fire(menuId);
    return new Disposable(() => {
      const left = (this.#items.get(menuId) ?? []).filter((registered) => registered !== item);
      if (left.length > 0) this.#items.set(menuId, left);
      else this.#items.delete(menuId);
      this.#changed.fire(menuId);
    });
  }

  /** The entries of `menuId` whose `when` holds in `context`, sorted. */
  items(menuId: string, context: MenuContext = {}): readonly MenuItem[] {
    const items = this.#items.get(menuId) ?? [];
    return items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.when?.(context) ?? true)
      .sort((a, b) => compareGroups(a.item.group ?? '', b.item.group ?? '') || (a.item.order ?? 0) - (b.item.order ?? 0) || a.index - b.index)
      .map(({ item }) => item);
  }

  dispose(): void {
    this.#items.clear();
    this.#changed.dispose();
  }
}

function compareGroups(a: string, b: string): number {
  if (a === b) return 0;
  if (a === 'navigation') return -1;
  if (b === 'navigation') return 1;
  return a < b ? -1 : 1;
}
