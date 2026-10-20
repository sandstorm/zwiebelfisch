import type { Disposable } from '../../core/disposable/disposable';

/**
 * commands and key bindings (VS Code's `commands` namespace), and the menu entries that run commands
 * (`MenuItem`, registered with `workbench.registerMenuItem`).
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
   * AltGr+1 (Ctrl+Alt on Windows), `Ctrl+Minus` not Ctrl+Shift+Minus. A modifier tapped twice is a key, too (as VS
   * Code's `shift shift`): `Shift Shift`, `Alt Alt`, …, not while the user types in a text field. For a command people
   * run: declare the key (`contributes.keybindings`) instead.
   */
  registerKeybinding(key: string, command: string, args?: unknown): Disposable;
  /**
   * The commands declared for people (`contributes.commands`) that are registered now, in declaration order: what VS
   * Code's `getCommands` and its Command Palette show (search everywhere's "Commands"). Each runs without arguments.
   */
  getCommands(): readonly CommandContribution[];
  /** The key that runs command `id`, as people read it (`⌘⇧F`, `Ctrl+Shift+F`): the first bound; undefined: none. */
  keybindingLabel(id: string): string | undefined;
}

/** A command as people see it (VS Code's `contributes.commands` entry). */
export interface CommandContribution {
  /** The command's id (`registerCommand`). */
  readonly command: string;
  /** What it does, as a menu would say it ("Add comment", "New diagram…"). */
  readonly title: string;
  /** What it belongs to, shown before the title ("Comments: Add comment"). */
  readonly category?: string;
  /** An SVG icon (markup drawn in `currentColor`), for the menu entries that run it. */
  readonly icon?: string;
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

/**
 * One entry of a menu (VS Code's `contributes.menus` entry): a command by its id, shown while `when` holds. `C`: the
 * context of the menu it is in (what `when`, `enabled` and `toggled` are asked with).
 */
export interface MenuItem<C extends object = MenuContext> {
  /** The command the entry runs (`commands.executeCommand`), with the arguments of the menu it is in. */
  readonly command: string;
  /** What the entry says; default: its command's title (`contributes.commands`), else the command id. */
  readonly title?: string;
  /** What a button says in place of an icon, where the menu shows one without (VS Code's `shortTitle`: `25%`); default: the title. */
  readonly shortTitle?: string;
  /** An SVG icon (markup drawn in `currentColor`) before the title, where the menu shows icons (the tab bar); default: its command's. */
  readonly icon?: string;
  /**
   * Whether the entry shows, given the context the menu is shown in (e.g. `(context) => context.resourceKind ===
   * 'folder'`); default: always. Asked each time the menu is shown.
   */
  readonly when?: (context: C) => boolean;
  /**
   * Whether the entry can be chosen now (VS Code's `enablement`), where the menu shows entries disabled (the Visual
   * editor's); default: always. Asked each time the menu is shown.
   */
  readonly enabled?: (context: C) => boolean;
  /**
   * Whether the entry is checked (VS Code's `toggled`), for an entry that turns something on or off; asked each time
   * the menu is shown. A menu shows it as a check mark (`role="menuitemcheckbox"`), a toolbar as pressed; default: not
   * a checkbox.
   */
  readonly toggled?: (context: C) => boolean;
  /**
   * A key of the editor showing the menu that does the same (its own keymap's, `Mod+B`), shown with the entry while the
   * command has no key binding of its own (`registerKeybinding`).
   */
  readonly keybinding?: string;
  /** What it belongs to, where a menu shows that (the Visual editor's text style menu: a section's title). */
  readonly category?: string;
  /** Other words it is found by where entries are searched (the slash commands): `['grid']` for a table. */
  readonly keywords?: readonly string[];
  /** Entries are grouped by this: `navigation` first, the others by name, a separator between groups; default ''. */
  readonly group?: string;
  /** The place in its group (lower first; equal: registration order); default 0. */
  readonly order?: number;
}

/** What a menu is shown for (VS Code's context keys), by key, e.g. `{ activeCustomEditorId: 'sourceEditor', resource: '/main.typ' }`. */
export type MenuContext = Readonly<Record<string, unknown>>;

export { CommandsHost } from './commands-impl';
export { keyLabel } from './commands-helpers';
