// StorageMemento. See ../workbench.ts.
import type { Memento } from '../workbench';

/**
 * Values as JSON in `storage` under `prefix` + key. Without storage (blocked, full, no window) `get` gives the default
 * and `update` keeps nothing; neither fails.
 *
 * Values kept in the browser's storage under a key prefix (VS Code's Memento): the extensions' `globalState`
 * (localStorage) and `workspaceState` (sessionStorage), each scoped by the extension's id, and the layout's sizes and
 * panels.
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

  keys(): readonly string[] {
    try {
      const storage = this.storage();
      const all = storage ? Array.from({ length: storage.length }, (_, i) => storage.key(i) ?? '') : [];
      return all.filter((key) => key.startsWith(this.prefix)).map((key) => key.slice(this.prefix.length));
    } catch {
      return [];
    }
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
