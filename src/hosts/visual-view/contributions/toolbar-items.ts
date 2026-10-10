// What contributions put into the Visual view's toolbar: buttons (actions), controls, groups, menus and floating
// bars. See contributions.ts.
import type { ChainedCommands, Editor } from '@tiptap/core';
import type { Anchor } from '../../../ui/floating-bar/floating-bar';
import type { Disposable } from '../../../core/disposable/disposable';
import type { VisualViewContext } from './view-context';

/** A toolbar button: how it looks, what it does, and when it shows as on. */
export interface Action {
  label: string;
  /** Shortcut shown in the tooltip; `Mod` becomes ⌘ or Ctrl. */
  shortcut?: string;
  icon: string;
  /** The command; also decides, dry-run, whether the button is enabled. */
  run(chain: ChainedCommands): ChainedCommands;
  /** Instead of running the command, e.g. to ask for a value first. */
  click?(button: HTMLButtonElement): void;
  /** Whether the button is enabled, instead of the dry run of `run`. */
  enabled?(editor: Editor): boolean;
  /** Toggles show their state (`aria-pressed`); plain actions (undo) do not. */
  active?(editor: Editor): boolean;
  /** In a floating bar: shows the bar at its anchor also without a selection (a link at the cursor). */
  showsBar?(editor: Editor): boolean;
}

/** A toolbar icon: 24×24 outline strokes in the text colour. */
export const svg = (body: string): string =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

/** A control of its own in the toolbar (the text style `<select>`). */
export interface ToolbarControl {
  readonly element: HTMLElement;
  /** Shows the selection's state; called after every transaction, focus and blur. */
  refresh(): void;
  destroy?(): void;
}

/**
 * A place for toolbar items: a group of buttons in the toolbar row, a menu
 * button there ("Insert ▾", its icon following the selection), or a bar
 * floating in the text above its anchor. The row is sorted by `order`; of the
 * floating bars, only the first (by `order`) with an anchor shows. The host's
 * own: `history` (undo/redo, order 10), the `insert` menu ("Insert", 50) and
 * the `selection` bar (above a text selection, 10).
 */
export type ToolbarGroup =
  | { readonly kind: 'group'; readonly id: string; readonly order: number }
  | { readonly kind: 'menu'; readonly id: string; readonly order: number; readonly label: string; icon(editor: Editor): string }
  | {
      readonly kind: 'floating';
      readonly id: string;
      readonly order: number;
      readonly label: string;
      /** Where the bar floats (null: hidden); `held` when an item asks to show it (see `Action.showsBar`). */
      anchor(editor: Editor, held: boolean): Anchor;
    };

/** What an item created per view gets: the view, its editor, the toolbar. */
export interface ToolbarContext extends VisualViewContext {
  readonly editor: Editor;
  /** The toolbar row's element (popovers of menu items go in here). */
  readonly root: HTMLElement;
  /** Disposed with the toolbar: popovers, listeners, plugins an item adds. */
  readonly subscriptions: Disposable[];
  /** The element of group `id`: a floating bar (to hold a popover of its item), a menu, a group; null if not shown. */
  element(group: string): HTMLElement | null;
  /** Shows every button's state anew and places the floating bars. */
  refresh(): void;
}

/** A button (or control) in toolbar group `group`, sorted by `order` (then registration order). */
export type ToolbarItem =
  | { readonly group: string; readonly order?: number; readonly action: Action }
  | {
      readonly group: string;
      readonly order?: number;
      /** The item for one view, when it keeps state there (a popover) or is a control of its own. */
      create(toolbar: ToolbarContext): Action | ToolbarControl;
    };
