// See Commands in commands.ts.
import { Disposable } from '../../core/disposable/disposable';
import type { Commands, KeybindingContribution, Platform } from './commands';

/**
 * The `Commands` of one widget. Keys are handled on `root` in the capture phase: no editor sees a bound key.
 * `platform`: whose keys these are (on the Mac Mod is Cmd, labels read ⌘⇧F); default: as the browser says.
 */
export class CommandsHost implements Commands {
  readonly #handlers = new Map<string, CommandHandler>();
  readonly #keybindings = new Set<{ key: string; matches(event: KeyboardEvent): boolean; command: string; args: unknown[] }>();
  readonly #platform: Platform;
  readonly #mac: boolean;

  constructor(
    private readonly root: HTMLElement,
    options: { platform?: Platform } = {},
  ) {
    this.#platform = options.platform ?? PLATFORM;
    this.#mac = this.#platform === 'mac';
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

  registerKeybinding(key: string, command: string, args?: unknown): Disposable {
    const binding = { key, matches: parseKey(key, this.#mac), command, args: args === undefined ? [] : [args] };
    this.#keybindings.add(binding);
    return new Disposable(() => this.#keybindings.delete(binding));
  }

  /** Binds the keys the extensions declare (`contributes.keybindings`), each the platform's own if it has one, for the widget's life. */
  declareKeybindings(keybindings: readonly KeybindingContribution[]): void {
    for (const keybinding of keybindings) {
      const key = keybinding[this.#platform] ?? keybinding.key;
      if (key) this.registerKeybinding(key, keybinding.command, keybinding.args);
    }
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
      this.executeCommand(binding.command, ...binding.args).catch((error: unknown) => console.error(`Command ${binding.command} failed:`, error));
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

const PLATFORM: Platform = typeof navigator === 'undefined' ? 'linux' : /Mac|iPhone|iPad/.test(navigator.platform) ? 'mac' : /Win/.test(navigator.platform) ? 'win' : 'linux';

const IS_MAC = PLATFORM === 'mac';

/** The modifiers as people read them, outside the Mac and on it. */
const LABELS: Record<string, string> = { Mod: 'Ctrl', Ctrl: 'Ctrl', Meta: 'Meta', Alt: 'Alt', Shift: 'Shift' };

const MAC_LABELS: Record<string, string> = { Mod: '⌘', Ctrl: '⌃', Meta: '⌘', Alt: '⌥', Shift: '⇧' };

/** Keys (`KeyboardEvent.code`) whose name is not what people read; `KeyM` and `Digit1` lose their prefix. */
const KEY_NAMES: Record<string, string> = { Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Semicolon: ';', Quote: "'", Backquote: '`' };
