// See Extension in extension-host.ts.
import { Disposable } from '../../core/disposable/disposable';
import type { Extension, ExtensionContext, ExtensionContributions, ExtensionHostOptions, Memento } from './extension-host';

/**
 * Runs a list of extensions: declares what each one `contributes` (settings, languages, keys, commands) to the hosts,
 * then activates each once, in list order, with its own `subscriptions` and storage (`globalState`, `workspaceState`,
 * scoped by its id). `dispose` disposes the extensions in reverse list order, each one's subscriptions in reverse order,
 * so whatever was registered later (and may depend on what came before) goes first.
 */
export class ExtensionHost {
  readonly #activated: { dispose(): unknown }[][] = [];

  constructor(private readonly options: ExtensionHostOptions) {}

  /**
   * Declares the contributions of `extensions`, then activates them (in order). Once. An id listed twice is an error;
   * values set for settings no one declares are reported (console) and ignored.
   */
  activate(extensions: readonly Extension[]): void {
    const ids = new Set<string>();
    for (const extension of extensions) {
      if (ids.has(extension.id)) throw new Error(`Extension ${extension.id} is in the list twice`);
      ids.add(extension.id);
      this.#declare(extension.contributes ?? {});
    }
    this.options.workspace.check();
    for (const extension of extensions) {
      const subscriptions: { dispose(): unknown }[] = [];
      this.#activated.push(subscriptions);
      extension.activate(this.#context(extension.id, subscriptions));
    }
  }

  dispose(): void {
    for (const subscriptions of this.#activated.splice(0).reverse()) Disposable.from(...subscriptions).dispose();
  }

  #declare({ configuration, languages, keybindings, commands }: ExtensionContributions): void {
    this.options.workspace.declare(configuration?.properties ?? {});
    this.options.languages.declare(languages ?? []);
    this.options.commands.declareKeybindings(keybindings);
    this.options.commands.declareCommands(commands);
    this.options.window.declareCommands(commands);
  }

  #context(id: string, subscriptions: ExtensionContext['subscriptions']): ExtensionContext {
    const { project, window } = this.options;
    return {
      ...this.options,
      subscriptions,
      globalState: StorageMemento.of(window.ownerDocument, 'localStorage', `zwf:global:${id}:`),
      workspaceState: StorageMemento.of(window.ownerDocument, 'sessionStorage', `zwf:${project.main}:${id}:`),
    };
  }
}

/**
 * Values as JSON in `storage` under `prefix` + key (VS Code's Memento): the extensions' `globalState` (localStorage)
 * and `workspaceState` (sessionStorage), each scoped by the extension's id, and the window layout's sizes and panels.
 * Without storage (blocked, full, no window) `get` gives the default and `update` keeps nothing; neither fails.
 */
export class StorageMemento implements Memento {
  constructor(
    private readonly storage: () => Storage | null,
    private readonly prefix: string,
  ) {}

  /** The memento of `doc`'s window's `kind` storage under `prefix` (no window or no access: none). */
  static of(doc: Document, kind: 'localStorage' | 'sessionStorage', prefix: string): StorageMemento {
    return new StorageMemento(() => {
      try {
        return doc.defaultView?.[kind] ?? null;
      } catch {
        return null;
      }
    }, prefix);
  }

  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  get<T>(key: string, defaultValue?: T): T | undefined {
    try {
      const text = this.storage()?.getItem(this.prefix + key);
      return text == null ? defaultValue : (JSON.parse(text) as T);
    } catch {
      return defaultValue;
    }
  }

  update(key: string, value: unknown): Promise<void> {
    try {
      const storage = this.storage();
      if (value === undefined) storage?.removeItem(this.prefix + key);
      else storage?.setItem(this.prefix + key, JSON.stringify(value));
    } catch {
      // storage full or blocked: the value lasts as long as whoever holds it
    }
    return Promise.resolve();
  }
}
