// See registerMenuItem in ../workbench.ts.
import { Disposable } from '../../../core/disposable/disposable';
import { EventEmitter } from '../../../core/event-emitter/event-emitter';
import type { CommandContribution, MenuItem } from '../../commands/commands';

/**
 * Every menu's registered entries (`registerMenuItem`). A menu is only an id: whoever shows it (the tab bar here,
 * `window.showContextMenu`) asks for the entries that apply in its context (`items`), in VS Code's order: group
 * `navigation` first, the other groups by name, within a group by `order`, then registration order. An entry without
 * a title or icon of its own shows its command's (`contributes.commands`, declared before any entry registers).
 */
export class Menus {
  // each menu's items take the context its shower documents: kept as any, typed again by who asks
  readonly #items = new Map<string, MenuItem<any>[]>();
  readonly #changed = new EventEmitter<string>();
  readonly onDidChange = this.#changed.event;
  readonly #declared = new Map<string, CommandContribution>();

  /** Declares commands (`contributes.commands`), whose title and icon the entries registered later show by default. */
  declareCommands(commands: readonly CommandContribution[] = []): void {
    for (const command of commands) this.#declared.set(command.command, command);
  }

  register<C extends object>(menuId: string, registered: MenuItem<C>): Disposable {
    const declared = this.#declared.get(registered.command);
    const item = { ...registered, title: registered.title ?? declared?.title ?? registered.command, icon: registered.icon ?? declared?.icon };
    const items = this.#items.get(menuId) ?? [];
    this.#items.set(menuId, [...items, item]);
    this.#changed.fire(menuId);
    return new Disposable(() => {
      const left = (this.#items.get(menuId) ?? []).filter((other) => other !== item);
      if (left.length > 0) this.#items.set(menuId, left);
      else this.#items.delete(menuId);
      this.#changed.fire(menuId);
    });
  }

  /** The entries of `menuId` whose `when` holds in `context`, sorted. */
  items<C extends object>(menuId: string, context: C = {} as C): readonly MenuItem<C>[] {
    const items: MenuItem<C>[] = this.#items.get(menuId) ?? [];
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
