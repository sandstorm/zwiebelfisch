// See VisualEditor in ../visual-editor-impl.ts.
import { TextSelection } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/core';
import { FloatingBar } from './floating-bar';
import { TextStyleMenu, textStyleEntries } from './text-style-menu';
import { ToolbarMenu, type MenuItems } from './toolbar-menu';
import type { Disposable } from '../../../core/disposable/disposable';
import { keyLabel } from '../../commands/commands';
import { svg, type ToolbarAction, type Anchor, type ToolbarContext, type ToolbarControl, type ToolbarGroup, type ToolbarItem, type TextStyle, type TextStyleProvider, type VisualEditorContext } from '../visual-editor';

/**
 * The Visual editor's formatting toolbar: a row of groups and menus sorted by `order` (the host's own: undo/redo, the
 * text style menu, "Insert"), and bars floating above their anchor in the text (the "Selection" bar above a text
 * selection), of which only the first with an anchor shows.
 *
 * Contributions fill them with items. Buttons reflect the selection (pressed, disabled, hidden) after every
 * transaction, focus and blur, and never take the focus away from the text.
 *
 * @internal Extensions fill it through `visualEditor.registerToolbarGroup` and `registerToolbarItem`.
 */
export class Toolbar {
  private readonly root: HTMLElement;
  private readonly refreshers: (() => void)[] = [];
  private readonly refresh = () => this.refreshers.forEach((fn) => fn());
  private readonly subscriptions: Disposable[] = [];
  private readonly disposers: (() => void)[] = [];
  /** The entries of every group, as shown (none while they are made). */
  private entriesByGroup = new Map<string, Entry[]>();

  constructor(
    parent: HTMLElement,
    private readonly tiptap: Editor,
    private readonly editor: VisualEditorContext,
    private readonly options: { groups: readonly ToolbarGroup[]; items: readonly ToolbarItem[]; textStyles: readonly TextStyleProvider[] },
  ) {
    const { groups, items, textStyles } = options;
    const doc = parent.ownerDocument;
    this.root = doc.createElement('div');
    this.root.className = 'zwf-toolbar';
    this.root.setAttribute('role', 'toolbar');
    this.root.setAttribute('aria-label', 'Formatting');
    // Keep the selection in the text: buttons act on it, they must not take focus.
    this.root.addEventListener('mousedown', (event) => {
      if ((event.target as HTMLElement).closest('button')) event.preventDefault();
    });
    const context = this.context(editor);
    const all = [...HOST_GROUPS, ...groups];
    const textStyleMenu: ToolbarItem[] = textStyles.length > 0 ? [{ group: 'text-style', create: (toolbar) => new TextStyleMenu(doc, tiptap, toolbar, textStyles) }] : [];
    // a menu in a floating bar is one of the bar's items, at its `order`
    const barMenus: ToolbarItem[] = all.flatMap((group) => (group.kind === 'menu' && group.bar ? [{ group: group.bar, order: group.order, create: () => this.menu(group) }] : []));
    const entries = this.entries([...HOST_ITEMS, ...textStyleMenu, ...items, ...barMenus], context);
    this.entriesByGroup = entries;
    const sorted = (kinds: ToolbarGroup['kind'][]) => [...all].filter((group) => kinds.includes(group.kind)).sort((a, b) => a.order - b.order);
    for (const group of sorted(['group', 'menu'])) if (!(group.kind === 'menu' && group.bar)) this.rowGroup(group, entries.get(group.id) ?? []);
    parent.prepend(this.root);
    this.floatingBars(sorted(['floating']), entries);
    tiptap.on('transaction', this.refresh);
    tiptap.on('focus', this.refresh);
    tiptap.on('blur', this.refresh);
    this.refresh();
  }

  /** The buttons of group or menu `group`, sorted as shown. */
  actions(group: string): readonly ToolbarAction[] {
    return (this.entriesByGroup.get(group) ?? []).flatMap((entry) => ('provideActions' in entry ? entry.provideActions() : isAction(entry) ? [entry] : []));
  }

  /** The text style menu's entries, sorted as shown (without "Normal text"). */
  textStyles(): readonly TextStyle[] {
    return textStyleEntries(this.options.textStyles, this.editor);
  }

  dispose(): void {
    for (const subscription of [...this.subscriptions].reverse()) subscription.dispose();
    for (const dispose of this.disposers) dispose();
    this.tiptap.off('transaction', this.refresh);
    this.tiptap.off('focus', this.refresh);
    this.tiptap.off('blur', this.refresh);
    this.root.remove();
  }

  /** What items made for this editor get. */
  private context(editor: VisualEditorContext): ToolbarContext {
    return { ...editor, editor: this.tiptap, root: this.root, subscriptions: this.subscriptions };
  }

  /** The items' buttons and controls by group, each group's sorted by `order` (then as registered). */
  private entries(items: readonly ToolbarItem[], context: ToolbarContext): Map<string, Entry[]> {
    const sorted = items.map((item, index) => ({ item, index })).sort((a, b) => (a.item.order ?? 0) - (b.item.order ?? 0) || a.index - b.index);
    const byGroup = new Map<string, Entry[]>();
    for (const { item } of sorted) {
      const entry = 'action' in item ? item.action : 'create' in item ? item.create(context) : { provideActions: () => item.provideActions(context) };
      byGroup.set(item.group, [...(byGroup.get(item.group) ?? []), entry]);
    }
    return byGroup;
  }

  /** A group (or menu) in the toolbar row; nothing for a group without entries. */
  private rowGroup(group: ToolbarGroup, entries: Entry[]): void {
    if (entries.length === 0) return;
    const wrapper = this.root.ownerDocument.createElement('div');
    wrapper.className = 'zwf-toolbar__group';
    if (group.kind === 'menu') wrapper.append(this.control(this.menu(group)));
    else wrapper.append(...entries.filter(isShown).map((entry) => (isAction(entry) ? this.button(entry) : this.control(entry))));
    this.root.append(wrapper);
  }

  /** Menu `group`, holding the actions of its items as they are when it opens (new buttons only for new actions). */
  private menu(group: ToolbarGroup & { kind: 'menu' }): ToolbarMenu {
    let shown: { actions: readonly ToolbarAction[]; items: MenuItems } | null = null;
    return new ToolbarMenu(this.root.ownerDocument, group.label, {
      icon: () => group.icon(this.tiptap),
      hasItems: () => this.actions(group.id).length > 0,
      items: () => {
        const actions = this.actions(group.id);
        if (shown?.actions.length === actions.length && actions.every((action, i) => action === shown!.actions[i])) return shown.items;
        // the items' state shows only while the menu is open: refreshed by the menu, not after every transaction
        const refreshers: (() => void)[] = [];
        const buttons = actions.map((action) => this.button(action, refreshers));
        shown = { actions, items: { buttons, refresh: () => refreshers.forEach((fn) => fn()) } };
        return shown.items;
      },
    });
  }

  private control(control: ToolbarControl, refreshers = this.refreshers): HTMLElement {
    refreshers.push(() => control.refresh());
    if (control.dispose) this.disposers.push(() => control.dispose!());
    return control.element;
  }

  /**
   * The bars floating in the text column, each re-placed after every
   * transaction: shown above its anchor while the text or something in the
   * bar has the focus; only the first with an anchor shows. A bar's buttons are
   * refreshed only while it shows.
   */
  private floatingBars(groups: readonly ToolbarGroup[], entries: Map<string, Entry[]>): void {
    const container = this.tiptap.view.dom.parentElement!;
    const bars: (() => boolean)[] = [];
    for (const group of groups) {
      if (group.kind !== 'floating') continue;
      const items = (entries.get(group.id) ?? []).filter(isShown);
      if (items.length === 0) continue;
      const actions = items.filter(isAction);
      // the buttons' state shows only while the bar does: refreshed when it shows, not after every transaction
      const itemRefreshers: (() => void)[] = [];
      const bar = new FloatingBar(container, group.label, items.map((item) => (isAction(item) ? this.button(item, itemRefreshers) : this.control(item, itemRefreshers))));
      this.disposers.push(() => bar.dispose());
      const earlier = [...bars];
      const focused = () => this.tiptap.isFocused || bar.element.contains(bar.element.ownerDocument.activeElement);
      const visible = (item: ToolbarAction | ToolbarControl) => (isAction(item) ? (item.visible?.(this.tiptap) ?? true) : !(item instanceof ToolbarMenu) || item.hasItems);
      const anchor = (): Anchor => {
        if (!focused() || earlier.some((shown) => shown()) || !items.some(visible)) return null;
        return group.anchor(this.tiptap, actions.some((action) => action.showsBar?.(this.tiptap)));
      };
      this.refreshers.push(() => {
        const at = anchor();
        if (at) itemRefreshers.forEach((fn) => fn());
        bar.show(at);
      });
      bars.push(() => !bar.element.hidden);
      bar.element.addEventListener('focusout', () => queueMicrotask(this.refresh));
    }
  }

  /** A button for `action`, its state refreshed by `refreshers` (default: after every transaction, focus and blur). */
  private button(action: ToolbarAction, refreshers = this.refreshers): HTMLButtonElement {
    const button = this.root.ownerDocument.createElement('button');
    button.type = 'button';
    button.className = 'zwf-toolbar__button';
    if (action.icon) button.innerHTML = action.icon;
    else button.textContent = action.text ?? action.label;
    button.classList.toggle('zwf-toolbar__button--text', !action.icon);
    button.setAttribute('aria-label', action.label);
    button.title = action.shortcut ? `${action.label} (${keyLabel(action.shortcut)})` : action.label;
    button.addEventListener('click', () => (action.click ? action.click() : action.run?.(this.tiptap.chain().focus()).run()));
    refreshers.push(() => {
      button.disabled = action.enabled ? !action.enabled(this.tiptap) : action.run !== undefined && !action.run(this.tiptap.can().chain()).run();
      if (action.active) button.setAttribute('aria-pressed', String(action.active(this.tiptap)));
      if (action.visible) button.hidden = !action.visible(this.tiptap);
    });
    return button;
  }
}

/** The host's own places: undo/redo first, the text style menu, the "Insert" menu, the bar above a text selection. */
const HOST_GROUPS: ToolbarGroup[] = [
  { kind: 'group', id: 'history', order: 10 },
  { kind: 'group', id: 'text-style', order: 20 },
  { kind: 'menu', id: 'insert', order: 50, label: 'Insert', icon: () => ICONS.insert },
  { kind: 'floating', id: 'selection', order: 10, label: 'Selection', anchor: (editor, held) => (held || hasTextSelection(editor) ? selectionCoords(editor) : null) },
];

const ICONS = {
  undo: svg('<path d="M9 15 4 10l5-5"/><path d="M4 10h11a5 5 0 0 1 0 10h-3"/>'),
  redo: svg('<path d="m15 15 5-5-5-5"/><path d="M20 10H9a5 5 0 0 0 0 10h3"/>'),
  insert: svg('<path d="M12 5v14M5 12h14"/>'),
};

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

const HOST_ITEMS: ToolbarItem[] = [
  { group: 'history', action: { label: 'Undo', shortcut: 'Mod+Z', icon: ICONS.undo, run: (c) => c.undo() } },
  { group: 'history', action: { label: 'Redo', shortcut: 'Mod+Shift+Z', icon: ICONS.redo, run: (c) => c.redo() } },
];

/** What a group holds: buttons, controls (a menu in a floating bar is one), and the actions of a menu that change. */
type Entry = ToolbarAction | ToolbarControl | { provideActions(): readonly ToolbarAction[] };

function isAction(entry: Entry): entry is ToolbarAction {
  return !('element' in entry) && !('provideActions' in entry);
}

/** Whether it is a button or control of its own (not actions for a menu). */
function isShown(entry: Entry): entry is ToolbarAction | ToolbarControl {
  return !('provideActions' in entry);
}
