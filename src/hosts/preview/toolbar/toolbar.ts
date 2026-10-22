// See Preview in ../preview-impl.ts.
import { Disposable } from '../../../core/disposable/disposable';
import type { Event } from '../../../core/event-emitter/event-emitter';
import { keyLabel, type MenuItem } from '../../commands/commands';
import type { PreviewMenuContext } from '../preview';

/**
 * The preview's toolbar: the menu `preview/toolbar`, a group of buttons per entry group, the last group at the row's
 * end. A button shows its entry's icon, else its short title, else its title; its title and key as tooltip; pressed
 * (`aria-pressed`) while `toggled`, disabled while not `enabled`; `data-command` names its command. A click runs the
 * command with the menu context.
 *
 * Shown anew on `refresh`, when the menu's entries change, after a setting changed (once its listeners ran), and when
 * a command run from it returned and settled. A button is made once per entry, so it keeps the focus.
 *
 * @internal Extensions fill it through `window.registerMenuItem('preview/toolbar', …)`.
 */
export class PreviewToolbar {
  /** The buttons of the entries shown so far. */
  private readonly buttons = new Map<MenuItem<PreviewMenuContext>, HTMLButtonElement>();
  private readonly subscriptions: Disposable[];

  constructor(
    private readonly element: HTMLElement,
    private readonly menus: PreviewMenus,
    private readonly context: () => PreviewMenuContext,
  ) {
    element.setAttribute('role', 'toolbar');
    element.setAttribute('aria-label', 'Preview');
    this.subscriptions = [
      menus.onDidChangeMenu((menuId) => menuId === PREVIEW_TITLE && this.refresh()),
      menus.onDidChangeConfiguration(() => queueMicrotask(() => this.refresh())),
    ];
    this.refresh();
  }

  /** Shows the entries that apply now, with their state. */
  refresh(): void {
    const context = this.context();
    const items = this.menus.getMenuItems(PREVIEW_TITLE, context);
    for (const item of this.buttons.keys()) if (!items.includes(item)) this.buttons.delete(item);
    const buttons = items.map((item) => this.buttons.get(item) ?? this.button(item));
    const shown = [...this.element.querySelectorAll(':scope > .zwf-preview__toolbar-group > button')];
    if (shown.length !== buttons.length || buttons.some((button, i) => button !== shown[i])) this.element.replaceChildren(...this.groups(items, buttons));
    items.forEach((item, i) => {
      buttons[i].disabled = item.enabled ? !item.enabled(context) : false;
      if (item.toggled) buttons[i].setAttribute('aria-pressed', String(item.toggled(context)));
    });
  }

  dispose(): void {
    for (const subscription of this.subscriptions) subscription.dispose();
    this.element.replaceChildren();
  }

  /** `buttons` (of `items`) in a group element per entry group. */
  private groups(items: readonly MenuItem<PreviewMenuContext>[], buttons: readonly HTMLButtonElement[]): HTMLElement[] {
    const groups: HTMLElement[] = [];
    items.forEach((item, i) => {
      if (i === 0 || (item.group ?? '') !== (items[i - 1].group ?? '')) {
        groups.push(this.element.ownerDocument.createElement('div'));
        groups[groups.length - 1].className = 'zwf-preview__toolbar-group';
      }
      groups[groups.length - 1].append(buttons[i]);
    });
    return groups;
  }

  private button(item: MenuItem<PreviewMenuContext>): HTMLButtonElement {
    const button = this.element.ownerDocument.createElement('button');
    button.type = 'button';
    button.dataset.command = item.command;
    const title = item.title ?? item.command;
    if (item.icon) button.innerHTML = item.icon;
    else button.textContent = item.shortTitle ?? title;
    button.setAttribute('aria-label', title);
    const key = this.menus.keybindingLabel(item.command) ?? (item.keybinding && keyLabel(item.keybinding));
    button.title = key ? `${title} (${key})` : title;
    button.addEventListener('click', () => {
      const run = this.menus.executeCommand(item.command, this.context());
      this.refresh();
      run.catch((error: unknown) => console.error(`Command ${item.command} failed:`, error)).finally(() => this.refresh());
    });
    this.buttons.set(item, button);
    return button;
  }
}

/** Where the preview's toolbar gets the menu `preview/toolbar` from: the window's menus and commands. */
export interface PreviewMenus {
  /** The entries of `menuId` whose `when` holds in `context`, sorted (`window.getMenuItems`). */
  getMenuItems(menuId: string, context: PreviewMenuContext): readonly MenuItem<PreviewMenuContext>[];
  readonly onDidChangeMenu: Event<string>;
  /** A setting changed: the entries' `when`, `enabled` and `toggled` are asked again. */
  readonly onDidChangeConfiguration: Event<unknown>;
  executeCommand(command: string, ...args: unknown[]): Promise<unknown>;
  /** The key bound to `command`, as people read it; undefined: none. */
  keybindingLabel(command: string): string | undefined;
}

/** No menus: a toolbar without entries (a preview made without `menus`). */
export const NO_MENUS: PreviewMenus = {
  getMenuItems: () => [],
  onDidChangeMenu: () => Disposable.from(),
  onDidChangeConfiguration: () => Disposable.from(),
  executeCommand: async () => undefined,
  keybindingLabel: () => undefined,
};

/** The toolbar's menu. */
const PREVIEW_TITLE = 'preview/toolbar';
