// Toolbar: the Visual view's formatting toolbar, laid out from the contributed groups and items. See docs/architecture/visual-view.typ.
import { TextSelection } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/core';
import { FloatingBar } from './floating-bar';
import { TextStyleMenu } from './text-style-menu';
import { ToolbarMenu } from './toolbar-menu';
import type { Disposable } from '../../../core/disposable/disposable';
import { svg, type Action, type Anchor, type ToolbarContext, type ToolbarControl, type ToolbarGroup, type ToolbarItem, type TextStyleProvider, type VisualViewContext } from '../visual-view';

/**
 * The Visual view's formatting toolbar: a row of groups and menus sorted by
 * their `order` (the host's own: undo/redo first, the text style menu once
 * any provider contributes to it, the "Insert" menu), and
 * bars floating in the text column (they scroll with the text) above their
 * anchor while the text or the bar has focus — the host's "Selection" bar
 * above a text selection; of the floating bars, only the first with an anchor
 * shows. Contributions fill them with items. Buttons reflect the selection
 * (pressed, disabled) after every transaction, focus and blur, and never take
 * the focus away from the text. Groups without items are left out.
 */
export class Toolbar {
  private readonly root: HTMLElement;
  private readonly refreshers: (() => void)[] = [];
  private readonly refresh = () => this.refreshers.forEach((fn) => fn());
  private readonly subscriptions: Disposable[] = [];
  private readonly disposers: (() => void)[] = [];

  constructor(
    parent: HTMLElement,
    private readonly editor: Editor,
    view: VisualViewContext,
    { groups, items, textStyles }: { groups: readonly ToolbarGroup[]; items: readonly ToolbarItem[]; textStyles: readonly TextStyleProvider[] },
  ) {
    const doc = parent.ownerDocument;
    this.root = doc.createElement('div');
    this.root.className = 'typst-toolbar';
    this.root.setAttribute('role', 'toolbar');
    this.root.setAttribute('aria-label', 'Formatting');
    // Keep the selection in the text: buttons act on it, they must not take focus.
    this.root.addEventListener('mousedown', (event) => {
      if ((event.target as HTMLElement).closest('button')) event.preventDefault();
    });
    const context = this.context(view);
    const all = [...HOST_GROUPS, ...groups];
    const textStyleMenu: ToolbarItem[] = textStyles.length > 0 ? [{ group: 'text-style', create: (toolbar) => new TextStyleMenu(doc, editor, toolbar, textStyles) }] : [];
    const entries = this.entries([...HOST_ITEMS, ...textStyleMenu, ...items], context);
    const sorted = (kinds: ToolbarGroup['kind'][]) => [...all].filter((group) => kinds.includes(group.kind)).sort((a, b) => a.order - b.order);
    for (const group of sorted(['group', 'menu'])) this.rowGroup(group, entries.get(group.id) ?? []);
    parent.prepend(this.root);
    this.floatingBars(sorted(['floating']), entries);
    editor.on('transaction', this.refresh);
    editor.on('focus', this.refresh);
    editor.on('blur', this.refresh);
    this.refresh();
  }

  dispose(): void {
    for (const subscription of [...this.subscriptions].reverse()) subscription.dispose();
    for (const dispose of this.disposers) dispose();
    this.editor.off('transaction', this.refresh);
    this.editor.off('focus', this.refresh);
    this.editor.off('blur', this.refresh);
    this.root.remove();
  }

  /** What items made for this view get. */
  private context(view: VisualViewContext): ToolbarContext {
    return { ...view, editor: this.editor, root: this.root, subscriptions: this.subscriptions };
  }

  /** The items' buttons and controls by group, each group's sorted by `order` (then as registered). */
  private entries(items: readonly ToolbarItem[], context: ToolbarContext): Map<string, (Action | ToolbarControl)[]> {
    const sorted = items.map((item, index) => ({ item, index })).sort((a, b) => (a.item.order ?? 0) - (b.item.order ?? 0) || a.index - b.index);
    const byGroup = new Map<string, (Action | ToolbarControl)[]>();
    for (const { item } of sorted) {
      const entry = 'action' in item ? item.action : item.create(context);
      byGroup.set(item.group, [...(byGroup.get(item.group) ?? []), entry]);
    }
    return byGroup;
  }

  /** A group (or menu) in the toolbar row; nothing for a group without entries. */
  private rowGroup(group: ToolbarGroup, entries: (Action | ToolbarControl)[]): void {
    if (entries.length === 0) return;
    const wrapper = this.root.ownerDocument.createElement('div');
    wrapper.className = 'typst-toolbar__group';
    if (group.kind === 'menu') {
      const buttons = entries.filter(isAction).map((action) => this.button(action));
      const menu = new ToolbarMenu(this.root.ownerDocument, group.label, () => group.icon(this.editor), buttons);
      this.refreshers.push(() => menu.refresh());
      this.disposers.push(() => menu.dispose());
      wrapper.append(menu.element);
    } else {
      wrapper.append(...entries.map((entry) => (isAction(entry) ? this.button(entry) : this.control(entry))));
    }
    this.root.append(wrapper);
  }

  private control(control: ToolbarControl): HTMLElement {
    this.refreshers.push(() => control.refresh());
    if (control.dispose) this.disposers.push(() => control.dispose!());
    return control.element;
  }

  /**
   * The bars floating in the text column, each re-placed after every
   * transaction: shown above its anchor while the text or something in the
   * bar has the focus; only the first with an anchor shows.
   */
  private floatingBars(groups: readonly ToolbarGroup[], entries: Map<string, (Action | ToolbarControl)[]>): void {
    const container = this.editor.view.dom.parentElement!;
    const bars: (() => boolean)[] = [];
    for (const group of groups) {
      if (group.kind !== 'floating') continue;
      const actions = (entries.get(group.id) ?? []).filter(isAction);
      if (actions.length === 0) continue;
      const bar = new FloatingBar(container, group.label, actions.map((action) => this.button(action)));
      this.disposers.push(() => bar.dispose());
      const earlier = [...bars];
      const focused = () => this.editor.isFocused || bar.element.contains(bar.element.ownerDocument.activeElement);
      const anchor = (): Anchor => {
        if (!focused() || earlier.some((shown) => shown())) return null;
        return group.anchor(this.editor, actions.some((action) => action.showsBar?.(this.editor)));
      };
      this.refreshers.push(() => bar.show(anchor()));
      bars.push(() => !bar.element.hidden);
      bar.element.addEventListener('focusout', () => queueMicrotask(this.refresh));
    }
  }

  private button(action: Action): HTMLButtonElement {
    const button = this.root.ownerDocument.createElement('button');
    button.type = 'button';
    button.className = 'typst-toolbar__button';
    button.innerHTML = action.icon;
    button.setAttribute('aria-label', action.label);
    button.title = action.shortcut ? `${action.label} (${shortcutText(action.shortcut)})` : action.label;
    button.addEventListener('click', () => (action.click ? action.click(button) : action.run?.(this.editor.chain().focus()).run()));
    this.refreshers.push(() => {
      button.disabled = action.enabled ? !action.enabled(this.editor) : action.run !== undefined && !action.run(this.editor.can().chain()).run();
      if (action.active) button.setAttribute('aria-pressed', String(action.active(this.editor)));
    });
    return button;
  }
}

function isAction(entry: Action | ToolbarControl): entry is Action {
  return !('element' in entry);
}

function shortcutText(shortcut: string): string {
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  return shortcut.replace('Mod', mac ? '⌘' : 'Ctrl').replace('Shift', mac ? '⇧' : 'Shift').replace('Alt', mac ? '⌥' : 'Alt').replace(/\+/g, mac ? '' : '+');
}

const ICONS = {
  undo: svg('<path d="M9 15 4 10l5-5"/><path d="M4 10h11a5 5 0 0 1 0 10h-3"/>'),
  redo: svg('<path d="m15 15 5-5-5-5"/><path d="M20 10H9a5 5 0 0 0 0 10h3"/>'),
  insert: svg('<path d="M12 5v14M5 12h14"/>'),
};

/** The host's own places: undo/redo first, the text style menu, the "Insert" menu, the bar above a text selection. */
const HOST_GROUPS: ToolbarGroup[] = [
  { kind: 'group', id: 'history', order: 10 },
  { kind: 'group', id: 'text-style', order: 20 },
  { kind: 'menu', id: 'insert', order: 50, label: 'Insert', icon: () => ICONS.insert },
  { kind: 'floating', id: 'selection', order: 10, label: 'Selection', anchor: (editor, held) => (held || hasTextSelection(editor) ? selectionCoords(editor) : null) },
];

const HOST_ITEMS: ToolbarItem[] = [
  { group: 'history', action: { label: 'Undo', shortcut: 'Mod+Z', icon: ICONS.undo, run: (c) => c.undo() } },
  { group: 'history', action: { label: 'Redo', shortcut: 'Mod+Shift+Z', icon: ICONS.redo, run: (c) => c.redo() } },
];

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
