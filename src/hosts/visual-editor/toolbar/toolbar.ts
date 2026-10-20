// See VisualEditor in ../visual-editor-impl.ts.
import { TextSelection } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/core';
import { FloatingBarView } from './floating-bar';
import { TextStyleMenu } from './text-style-menu';
import { ToolbarMenu, type MenuItems } from './toolbar-menu';
import type { Disposable } from '../../../core/disposable/disposable';
import type { Event } from '../../../core/event-emitter/event-emitter';
import { keyLabel } from '../../commands/commands';
import type { MenuItem } from '../../commands/commands';
import type { Anchor, FloatingBar, Submenu, VisualEditorMenuContext } from '../visual-editor';
import { svg } from '../visual-editor-helpers';

/**
 * The Visual editor's formatting toolbar: the row (the menu `visualEditor/toolbar`, a group of buttons per entry
 * group, with the submenus placed there, the host's "Insert" among them, and the text style menu of the menu
 * `visualEditor/textStyle`), and the bars
 * floating above their anchor in the text (the menu `visualEditor/selection` above a text selection, those of
 * `registerFloatingBar`), of which only the first with an anchor shows.
 *
 * Buttons reflect the selection (pressed, disabled, left out) after every transaction, focus and blur, and never take
 * the focus away from the text; a click runs the entry's command with the menu context.
 *
 * @internal Extensions fill it through `workbench.registerMenuItem`, `visualEditor.registerSubmenu` and
 * `registerFloatingBar`.
 */
export class Toolbar {
  private readonly root: HTMLElement;
  private readonly refreshers: (() => void)[] = [];
  private readonly refresh = () => this.refreshers.forEach((fn) => fn());
  private readonly disposers: (() => void)[] = [];
  private readonly subscription: Disposable;
  /** What the menus are shown with and their commands run with. */
  private readonly context: VisualEditorMenuContext;
  /** The buttons of each menu's entries, made once per entry (hidden while it is left out). */
  private readonly buttons = new Map<string, Map<MenuItem<VisualEditorMenuContext>, Placed>>();
  private readonly submenus = new Map<Submenu, Placed>();

  constructor(
    parent: HTMLElement,
    private readonly tiptap: Editor,
    private readonly options: {
      context: VisualEditorMenuContext;
      menus: ToolbarMenus;
      submenus: readonly Submenu[];
      floatingBars: readonly FloatingBar[];
    },
  ) {
    this.context = options.context;
    const doc = parent.ownerDocument;
    this.root = doc.createElement('div');
    this.root.className = 'zwf-toolbar';
    this.root.setAttribute('role', 'toolbar');
    this.root.setAttribute('aria-label', 'Formatting');
    // Keep the selection in the text: buttons act on it, they must not take focus.
    this.root.addEventListener('mousedown', (event) => {
      if ((event.target as HTMLElement).closest('button')) event.preventDefault();
    });
    const textStyles = new TextStyleMenu(doc, tiptap, options.context, options.menus);
    this.disposers.push(() => textStyles.dispose());
    const textStyleEntry: Placed = { group: TEXT_STYLE_GROUP, order: 0, element: textStyles.element, shows: () => true, refresh: () => textStyles.refresh() };
    // the text style menu while it has entries
    this.refreshers.push(() => this.showRow(this.entries(TOOLBAR, textStyles.items().length > 0 ? [textStyleEntry] : [])));
    parent.prepend(this.root);
    this.floatingBars([...HOST_BARS, ...options.floatingBars].sort((a, b) => a.order - b.order));
    this.subscription = options.menus.onDidChangeMenu(this.refresh);
    tiptap.on('transaction', this.refresh);
    tiptap.on('focus', this.refresh);
    tiptap.on('blur', this.refresh);
    this.refresh();
  }

  dispose(): void {
    this.subscription.dispose();
    for (const dispose of this.disposers) dispose();
    this.tiptap.off('transaction', this.refresh);
    this.tiptap.off('focus', this.refresh);
    this.tiptap.off('blur', this.refresh);
    this.root.remove();
  }

  /**
   * What menu `menuId` shows now, sorted as the workbench sorts menus: its entries whose `when` holds (the buttons of
   * the others hidden), the submenus placed in it, and `extras`.
   */
  private entries(menuId: string, extras: readonly Placed[] = []): Placed[] {
    const buttons = this.buttons.get(menuId) ?? new Map<MenuItem<VisualEditorMenuContext>, Placed>();
    this.buttons.set(menuId, buttons);
    const items = this.options.menus.getMenuItems(menuId, this.context);
    for (const [item, button] of buttons) if (!items.includes(item)) button.element.hidden = true;
    const shown = items.map((item) => {
      const button = buttons.get(item) ?? this.button(item);
      buttons.set(item, button);
      button.element.hidden = false;
      return button;
    });
    const submenus = [...HOST_SUBMENUS, ...this.options.submenus].filter((submenu) => submenu.parent === menuId).map((submenu) => this.submenu(submenu));
    return sortPlaced([...shown, ...submenus, ...extras]);
  }

  /** The row: a group of the entries per group (left out while empty), anew when the entries change; their state as now. */
  private showRow(entries: readonly Placed[]): void {
    const shown = [...this.root.querySelectorAll(':scope > .zwf-toolbar__group > *')];
    if (shown.length !== entries.length || entries.some((entry, i) => entry.element !== shown[i])) {
      const doc = this.root.ownerDocument;
      const groups: HTMLElement[] = [];
      let last: string | null = null;
      for (const entry of entries) {
        if (entry.group !== last || groups.length === 0) {
          groups.push(doc.createElement('div'));
          groups[groups.length - 1].className = 'zwf-toolbar__group';
          last = entry.group;
        }
        groups[groups.length - 1].append(entry.element);
      }
      this.root.replaceChildren(...groups);
    }
    for (const entry of entries) entry.refresh();
  }

  /** The button of submenu `submenu`, holding the entries of its menu as they are when it opens (new buttons only for new entries). */
  private submenu(submenu: Submenu): Placed {
    const made = this.submenus.get(submenu);
    if (made) return made;
    const items = () => this.options.menus.getMenuItems(submenu.id, this.context);
    let shown: { items: readonly MenuItem<VisualEditorMenuContext>[]; buttons: MenuItems } | null = null;
    const menu = new ToolbarMenu(this.root.ownerDocument, submenu.label, {
      icon: () => submenu.icon(this.context),
      hasItems: () => items().length > 0,
      items: () => {
        const now = items();
        if (shown?.items.length === now.length && now.every((item, i) => item === shown!.items[i])) return shown.buttons;
        // the entries' state shows only while the menu is open: refreshed by the menu, not after every transaction
        const buttons = now.map((item) => this.button(item));
        shown = { items: now, buttons: { buttons: buttons.map((button) => button.element as HTMLButtonElement), refresh: () => buttons.forEach((button) => button.refresh()) } };
        return shown.buttons;
      },
    });
    this.disposers.push(() => menu.dispose());
    const placed: Placed = { group: submenu.group ?? '', order: submenu.order ?? 0, element: menu.element, shows: () => menu.hasItems, refresh: () => menu.refresh() };
    this.submenus.set(submenu, placed);
    return placed;
  }

  /**
   * The bars floating in the text column, each re-placed after every transaction: shown above its anchor while the
   * text or something in the bar has the focus; only the first with an anchor and entries shows. A bar's buttons are
   * refreshed only while it shows.
   */
  private floatingBars(bars: readonly FloatingBar[]): void {
    const container = this.tiptap.view.dom.parentElement!;
    const shownBars: (() => boolean)[] = [];
    for (const bar of bars) {
      const view = new FloatingBarView(container, bar.label);
      this.disposers.push(() => view.dispose());
      const earlier = [...shownBars];
      const focused = () => this.tiptap.isFocused || view.element.contains(view.element.ownerDocument.activeElement);
      this.refreshers.push(() => {
        const entries = this.entries(bar.id);
        view.setEntries(entries.map((entry) => entry.element));
        const at = focused() && !earlier.some((shown) => shown()) && entries.some((entry) => entry.shows()) ? bar.anchor(this.context) : null;
        if (at) entries.forEach((entry) => entry.refresh());
        view.show(at);
      });
      shownBars.push(() => !view.element.hidden);
      view.element.addEventListener('focusout', () => queueMicrotask(this.refresh));
    }
  }

  /** A button for `item`: its icon (else its short title), its title and key as tooltip; `refresh` shows its state. */
  private button(item: MenuItem<VisualEditorMenuContext>): Placed {
    const button = this.root.ownerDocument.createElement('button');
    button.type = 'button';
    button.className = 'zwf-toolbar__button';
    const title = item.title ?? item.command;
    if (item.icon) button.innerHTML = item.icon;
    else button.textContent = item.shortTitle ?? title;
    button.classList.toggle('zwf-toolbar__button--text', !item.icon);
    button.setAttribute('aria-label', title);
    const key = this.options.menus.keybindingLabel(item.command) ?? (item.keybinding && keyLabel(item.keybinding));
    button.title = key ? `${title} (${key})` : title;
    button.addEventListener('click', () => {
      this.options.menus.executeCommand(item.command, this.context).catch((error: unknown) => console.error(`Command ${item.command} failed:`, error));
    });
    const refresh = () => {
      button.disabled = item.enabled ? !item.enabled(this.context) : false;
      if (item.toggled) button.setAttribute('aria-pressed', String(item.toggled(this.context)));
    };
    return { group: item.group ?? '', order: item.order ?? 0, element: button, shows: () => true, refresh };
  }
}

/** Where the toolbar's menus come from: the workbench's menus and commands. */
export interface ToolbarMenus {
  /** The entries of `menuId` whose `when` holds in `context`, sorted (`workbench.getMenuItems`). */
  getMenuItems(menuId: string, context: VisualEditorMenuContext): readonly MenuItem<VisualEditorMenuContext>[];
  readonly onDidChangeMenu: Event<string>;
  executeCommand(command: string, ...args: unknown[]): Promise<unknown>;
  /** The key bound to `command`, as people read it; undefined: none. */
  keybindingLabel(command: string): string | undefined;
}

/** An entry as a menu shows it: its place, its element, whether it shows (a submenu without entries does not), its state. */
interface Placed {
  readonly group: string;
  readonly order: number;
  readonly element: HTMLElement;
  shows(): boolean;
  refresh(): void;
}

/** The row's menu. */
const TOOLBAR = 'visualEditor/toolbar';
/** The row's group of the text style menu. */
const TEXT_STYLE_GROUP = '2_textStyle';

const ICONS = {
  insert: svg('<path d="M12 5v14M5 12h14"/>'),
};

/** The host's own menu button: "Insert" in the row. */
const HOST_SUBMENUS: Submenu[] = [{ id: 'visualEditor/insert', label: 'Insert', icon: () => ICONS.insert, parent: TOOLBAR, group: '5_insert' }];

/** The host's own bar: above a text selection. */
const HOST_BARS: FloatingBar[] = [{ id: 'visualEditor/selection', order: 10, label: 'Selection', anchor: ({ editor }) => (hasTextSelection(editor) ? selectionCoords(editor) : null) }];

/** `entries` as the workbench sorts a menu's: group `navigation` first, the others by name, then by order, then as given. */
function sortPlaced(entries: readonly Placed[]): Placed[] {
  const rank = (group: string) => (group === 'navigation' ? '' : `~${group}`);
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => (rank(a.entry.group) < rank(b.entry.group) ? -1 : rank(a.entry.group) > rank(b.entry.group) ? 1 : 0) || a.entry.order - b.entry.order || a.index - b.index)
    .map(({ entry }) => entry);
}

/** Whether the selection is non-empty text. */
function hasTextSelection(editor: Editor): boolean {
  const { selection, doc } = editor.state;
  return selection instanceof TextSelection && !selection.empty && doc.textBetween(selection.from, selection.to).trim() !== '';
}

/** Above the selection (or caret): centred over it on one line, over its start across lines. */
function selectionCoords(editor: Editor): Anchor {
  const { from, to } = editor.state.selection;
  try {
    const start = editor.view.coordsAtPos(from);
    const end = editor.view.coordsAtPos(to);
    return { top: Math.min(start.top, end.top), left: start.left, right: end.top === start.top ? end.right : start.left };
  } catch {
    return null; // no layout (e.g. not attached)
  }
}
