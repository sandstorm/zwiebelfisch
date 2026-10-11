import { Disposable } from '../../core/disposable/disposable';

/**
 * The widget's commands and key bindings (VS Code's `commands` namespace).
 *
 * Extensions never import each other. A command is how one offers an action to the others: it registers a handler
 * under an id, and anyone who knows the id runs it, be it another extension, a menu entry or a key binding. The
 * handler may be sync or async. It is still called synchronously, so the user's gesture, the selection and the focus
 * are as they were when the command was asked for. Key bindings live here too: a bound key is handled on the widget's
 * root before any editor sees it.
 *
 * Showing commands to people is left to others: menus are the workbench's and the window's, and search everywhere
 * lists the commands extensions declare (`contributes.commands`). See docs/40_architecture/07_workbench.typ.
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
   * Runs `command` (without arguments) on `key` anywhere in the widget, before the editors see the key (they never
   * do; a failing command is logged). `key`: modifiers and a `KeyboardEvent.code`, joined by `+`, e.g. `Mod+Alt+KeyM`
   * (Mod: Ctrl or Cmd). Unnamed modifiers are not checked.
   */
  registerKeybinding(key: string, command: string): Disposable;
}

/** A command as data (VS Code's Command), e.g. what a document link's hover offers to do. */
export interface Command {
  /** The label of the button or menu entry ("Create chapter.typ"). */
  readonly title: string;
  /** The id of the command (`commands.registerCommand`). */
  readonly command: string;
  /** The arguments it is run with. */
  readonly arguments?: readonly unknown[];
}

/** The `Commands` of one widget. Keys are handled on `root` in the capture phase: no editor sees a bound key. */
export class CommandsHost implements Commands {
  readonly #handlers = new Map<string, CommandHandler>();
  readonly #keybindings = new Set<{ matches(event: KeyboardEvent): boolean; command: string }>();

  constructor(private readonly root: HTMLElement) {
    root.addEventListener('keydown', this.#handleKey, true);
  }

  registerCommand(id: string, handler: CommandHandler): Disposable {
    if (this.#handlers.has(id)) throw new Error(`Command ${id} is registered already`);
    this.#handlers.set(id, handler);
    return new Disposable(() => this.#handlers.delete(id));
  }

  executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T> {
    const handler = this.#handlers.get(id);
    if (!handler) return Promise.reject(new Error(`No command ${id}`));
    try {
      return Promise.resolve(handler(...args) as T);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** Whether command `id` is registered now. */
  has(id: string): boolean {
    return this.#handlers.has(id);
  }

  registerKeybinding(key: string, command: string): Disposable {
    const binding = { matches: parseKey(key), command };
    this.#keybindings.add(binding);
    return new Disposable(() => this.#keybindings.delete(binding));
  }

  dispose(): void {
    this.root.removeEventListener('keydown', this.#handleKey, true);
    this.#handlers.clear();
    this.#keybindings.clear();
  }

  readonly #handleKey = (event: KeyboardEvent): void => {
    for (const binding of this.#keybindings) {
      if (!binding.matches(event) || !this.#handlers.has(binding.command)) continue;
      // decided now, while the event is dispatched; the command's outcome comes later
      event.preventDefault();
      event.stopPropagation();
      this.executeCommand(binding.command).catch((error: unknown) => console.error(`Command ${binding.command} failed:`, error));
      return;
    }
  };
}

/** A command's handler (VS Code's shape): the arguments the command documents, any result (a Promise is awaited). */
type CommandHandler = (...args: any[]) => unknown;

/** `Mod+Alt+KeyM` → a test for the event: the named modifiers pressed and that `code`. */
function parseKey(key: string): (event: KeyboardEvent) => boolean {
  const parts = key.split('+');
  const code = parts.pop()!;
  const modifiers = parts.map((name) => {
    const test = MODIFIERS[name];
    if (!test) throw new Error(`Unknown modifier ${name} in key ${key}`);
    return test;
  });
  return (event) => event.code === code && modifiers.every((pressed) => pressed(event));
}

const MODIFIERS: Record<string, (event: KeyboardEvent) => boolean> = {
  Mod: (event) => event.metaKey || event.ctrlKey,
  Ctrl: (event) => event.ctrlKey,
  Meta: (event) => event.metaKey,
  Alt: (event) => event.altKey,
  Shift: (event) => event.shiftKey,
};
