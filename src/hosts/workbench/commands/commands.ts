// Commands: what extensions register by id (`registerCommand`), run by id (`executeCommand`) and bind to keys
// (`registerKeybinding`). See workbench.ts.
import { Disposable } from '../../../core/disposable/disposable';
import type { CommandArguments, CommandRegistry, CommandResult } from '../workbench';

type Handler = (...args: never[]) => unknown;

/**
 * The widget's commands and key bindings. Keys are handled on `root` in the capture phase, so a bound key is
 * the widget's before an editor inside sees it (and the editor never does).
 */
export class Commands {
  readonly #handlers = new Map<string, Handler>();
  readonly #keybindings = new Set<{ matches(event: KeyboardEvent): boolean; command: string }>();

  constructor(private readonly root: HTMLElement) {
    root.addEventListener('keydown', this.#handleKey, true);
  }

  register<K extends keyof CommandRegistry>(id: K, handler: CommandRegistry[K]): Disposable {
    if (this.#handlers.has(id)) throw new Error(`Command ${String(id)} is registered already`);
    this.#handlers.set(id, handler as Handler);
    return new Disposable(() => this.#handlers.delete(id));
  }

  execute<K extends keyof CommandRegistry>(id: K, ...args: CommandArguments<K>): CommandResult<K> {
    const handler = this.#handlers.get(id);
    if (!handler) throw new Error(`No command ${String(id)}`);
    return handler(...(args as unknown as never[])) as CommandResult<K>;
  }

  /** Binds `key` (e.g. `Mod+Alt+KeyM`) to `command`. */
  bind(key: string, command: keyof CommandRegistry): Disposable {
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
      event.preventDefault();
      event.stopPropagation();
      this.#handlers.get(binding.command)!();
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
