import { Disposable } from '../../core/disposable/disposable';

/**
 * The widget's commands and key bindings (VS Code's `commands` namespace).
 *
 * Extensions never import each other. A command is how one offers an action to the others: it registers a handler
 * under an id, and anyone who knows the id runs it, be it another extension, a menu entry or a key binding. The
 * handler may be sync or async. It is still called synchronously, so the user's gesture, the selection and the focus
 * are as they were when the command was asked for. Key bindings live here too: a bound key is handled on the widget's
 * root before any editor sees it. Extensions declare most of theirs (`contributes.keybindings`), so the key of a
 * command is known wherever the command is offered.
 *
 * Showing commands to people is left to others: menus are the workbench's and the window's, and search everywhere
 * lists the commands extensions declare (`contributes.commands`); each shows a command's key
 * (`CommandsHost.keybindingLabel`). See docs/40_architecture/07_workbench.typ.
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
   * (Mod: Cmd on the Mac, else Ctrl). The modifiers must be exactly those (as VS Code's): `Alt+Digit1` is not
   * AltGr+1 (Ctrl+Alt on Windows), `Ctrl+Minus` not Ctrl+Shift+Minus. For a command people run: declare the key
   * (`contributes.keybindings`) instead.
   */
  registerKeybinding(key: string, command: string): Disposable;
}

/** A key that runs a command (VS Code's `contributes.keybindings` entry), as `registerKeybinding` takes it. */
export interface KeybindingContribution {
  /** The command's id; it runs without arguments. */
  readonly command: string;
  /** The key (`Mod+Shift+KeyF`). */
  readonly key: string;
  /** The key on the Mac instead, if another. */
  readonly mac?: string;
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

/**
 * The `Commands` of one widget. Keys are handled on `root` in the capture phase: no editor sees a bound key. `mac`:
 * whether keys are the Mac's (Mod is Cmd; labels such as ⌘⇧F); default: as the browser says.
 */
export class CommandsHost implements Commands {
  readonly #handlers = new Map<string, CommandHandler>();
  readonly #keybindings = new Set<{ key: string; matches(event: KeyboardEvent): boolean; command: string }>();
  readonly #mac: boolean;

  constructor(
    private readonly root: HTMLElement,
    options: { mac?: boolean } = {},
  ) {
    this.#mac = options.mac ?? IS_MAC;
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
    const binding = { key, matches: parseKey(key, this.#mac), command };
    this.#keybindings.add(binding);
    return new Disposable(() => this.#keybindings.delete(binding));
  }

  /** Binds the keys the extensions declare (`contributes.keybindings`), each the Mac's on the Mac, for the widget's life. */
  declareKeybindings(keybindings: readonly KeybindingContribution[]): void {
    for (const { command, key, mac } of keybindings) this.registerKeybinding((this.#mac && mac) || key, command);
  }

  /** The key that runs command `id`, as people read it (`⌘⇧F`, `Ctrl+Shift+F`): the first bound; undefined: none. */
  keybindingLabel(id: string): string | undefined {
    for (const binding of this.#keybindings) if (binding.command === id) return keyLabel(binding.key, this.#mac);
    return undefined;
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

/**
 * `key` (modifiers and a key, joined by `+`: a binding's `Mod+Alt+KeyM`, or a toolbar's `Mod+B`) as people read it:
 * on the Mac `⌘⌥M`, else `Ctrl+Alt+M`. `mac`: default as the browser says.
 */
export function keyLabel(key: string, mac = IS_MAC): string {
  const parts = key.split('+');
  const name = parts.pop()!;
  const keyName = KEY_NAMES[name] ?? name.replace(/^(Key|Digit)(?=.)/, '');
  const labels = mac ? MAC_LABELS : LABELS;
  return [...parts.map((modifier) => labels[modifier] ?? modifier), keyName].join(mac ? '' : '+');
}

/** `Mod+Alt+KeyM` → a test for the event: that `code`, and exactly the named modifiers pressed. */
function parseKey(key: string, mac: boolean): (event: KeyboardEvent) => boolean {
  const parts = key.split('+');
  const code = parts.pop()!;
  const wanted = new Set(
    parts.map((name) => {
      if (!(name in LABELS)) throw new Error(`Unknown modifier ${name} in key ${key}`);
      return name === 'Mod' ? (mac ? 'Meta' : 'Ctrl') : name;
    }),
  );
  return (event) =>
    event.code === code && event.ctrlKey === wanted.has('Ctrl') && event.metaKey === wanted.has('Meta') && event.altKey === wanted.has('Alt') && event.shiftKey === wanted.has('Shift');
}

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** The modifiers as people read them, outside the Mac and on it. */
const LABELS: Record<string, string> = { Mod: 'Ctrl', Ctrl: 'Ctrl', Meta: 'Meta', Alt: 'Alt', Shift: 'Shift' };
const MAC_LABELS: Record<string, string> = { Mod: '⌘', Ctrl: '⌃', Meta: '⌘', Alt: '⌥', Shift: '⇧' };

/** Keys (`KeyboardEvent.code`) whose name is not what people read; `KeyM` and `Digit1` lose their prefix. */
const KEY_NAMES: Record<string, string> = { Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Semicolon: ';', Quote: "'", Backquote: '`' };
