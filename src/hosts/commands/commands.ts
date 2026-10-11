// The commands namespace of the extension API (VS Code's `commands`): what extensions register by id
// (`registerCommand`), run by id (`executeCommand`) and bind to keys (`registerKeybinding`). Entry of
// hosts/commands/. See docs/30_architecture/07_workbench.typ.
// Why plain string ids and a Promise (VS Code's shape): extensions never depend on each other, so a caller knows a
// command only by its id, and the handler may be sync or async. The handler is called synchronously all the same,
// so user activation, the selection and the focus are as they were when the command was asked for.
import { Disposable } from '../../core/disposable/disposable';

/** The widget's commands as extensions use them (VS Code's `commands` namespace, with key bindings). */
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

/** A command's handler (VS Code's shape): the arguments the command documents, any result (a Promise is awaited). */
type CommandHandler = (...args: any[]) => unknown;

/**
 * The widget's commands and key bindings. Keys are handled on `root` in the capture phase, so a bound key is
 * the widget's before an editor inside sees it (and the editor never does).
 */
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

const MODIFIERS: Record<string, (event: KeyboardEvent) => boolean> = {
  Mod: (event) => event.metaKey || event.ctrlKey,
  Ctrl: (event) => event.ctrlKey,
  Meta: (event) => event.metaKey,
  Alt: (event) => event.altKey,
  Shift: (event) => event.shiftKey,
};

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
