import type { Disposable } from '../../core/disposable/disposable';

/**
 * commands and key bindings (VS Code's `commands` namespace).
 *
 * A command is how one extension offers an action to the others: it registers a handler
 * under an id, and anyone who knows the id runs it, so it's called from:
 * - other extensions
 * - menu entries
 * - key bindings
 *
 * Called synchronously, so f.e. selection and focus are guaranteed to not change between dispatching the command and the command's body.
 */
export interface Commands {
  /**
   * Registers `handler` as command `id` (`<extension>.<name>`, e.g. `pdfExport.export`) until disposed; an id
   * registered twice is an error. Other extensions and the host run it by id (`executeCommand`), never by importing it.
   */
  registerCommand(id: string, handler: (...args: any[]) => unknown): Disposable;
  /**
   * Runs command `id` with `args` and resolves to its result (awaited if it is a Promise). The handler is called
   * synchronously, so the user's gesture, the selection and the focus are as now. Rejects for an unknown id and when
   * the handler throws or rejects.
   */
  executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T>;
  /**
   * Runs `command` (with `args` as its one argument, if given) on `key` anywhere in the widget, before the editors see
   * the key (they never do; a failing command is logged). `key`: modifiers and a `KeyboardEvent.code`, joined by `+`, e.g. `Mod+Alt+KeyM`
   * (Mod: Cmd on the Mac, else Ctrl). The modifiers must be exactly those (as VS Code's): `Alt+Digit1` is not
   * AltGr+1 (Ctrl+Alt on Windows), `Ctrl+Minus` not Ctrl+Shift+Minus. For a command people run: declare the key
   * (`contributes.keybindings`) instead.
   */
  registerKeybinding(key: string, command: string, args?: unknown): Disposable;
}

/**
 * A key that runs a command (VS Code's `contributes.keybindings` entry), as `registerKeybinding` takes it. A
 * platform's own key replaces `key` there; '' is no key there.
 */
export interface KeybindingContribution {
  /** The command's id. */
  readonly command: string;
  /** The key (`Mod+Shift+KeyF`). */
  readonly key: string;
  /** The key on the Mac instead. */
  readonly mac?: string;
  /** The key on Windows instead. */
  readonly win?: string;
  /** The key on Linux (and any other system) instead. */
  readonly linux?: string;
  /** The command's one argument (none if not given). */
  readonly args?: unknown;
}

/** The systems whose keys differ (VS Code's `mac`, `win`, `linux`). */
export type Platform = 'mac' | 'win' | 'linux';

/** A command as data (VS Code's Command), e.g. what a document link's hover offers to do. */
export interface Command {
  /** The label of the button or menu entry ("Create chapter.typ"). */
  readonly title: string;
  /** The id of the command (`commands.registerCommand`). */
  readonly command: string;
  /** The arguments it is run with. */
  readonly arguments?: readonly unknown[];
}

export { CommandsHost, keyLabel } from './commands-impl';
