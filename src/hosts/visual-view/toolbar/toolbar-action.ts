// Toolbar actions: a button's icon, command and state. See toolbar.ts.
import type { ChainedCommands, Editor } from '@tiptap/core';

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
}

/** A toolbar icon: 24×24 outline strokes in the text colour. */
export const svg = (body: string): string =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
