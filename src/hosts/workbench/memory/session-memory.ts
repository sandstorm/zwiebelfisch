// SessionMemory: values a widget remembers for the browser session (`Workbench.remember`, the layout's sizes and
// panels). See workbench.ts.
import type { Memory } from '../workbench';

/**
 * Values in the session storage of `doc`'s window under `key` (one widget's) and a name. Without storage (blocked,
 * full, no window) nothing is remembered and nothing fails.
 */
export class SessionMemory {
  constructor(
    private readonly doc: Document,
    private readonly key: string,
  ) {}

  /** The value remembered under `name` (`name` tells this widget's values apart). */
  remember<T>(name: string): Memory<T> {
    const key = `${this.key}:${name}`;
    const storage = () => {
      try {
        return this.doc.defaultView?.sessionStorage ?? null;
      } catch {
        return null;
      }
    };
    return {
      load: () => {
        try {
          const text = storage()?.getItem(key);
          return text ? (JSON.parse(text) as T) : null;
        } catch {
          return null;
        }
      },
      save: (value) => {
        try {
          storage()?.setItem(key, JSON.stringify(value));
        } catch {
          // storage full or blocked: only this session's DOM keeps the state
        }
      },
    };
  }
}
