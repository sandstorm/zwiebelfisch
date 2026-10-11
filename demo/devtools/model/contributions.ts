// What each extension contributes, recorded as it activates: every `register…` call on its context's namespaces and
// the settings it declares. See ../devtools.ts.
import type { ExtensionContext, TypstExtension } from '../../../src';
import { describeArguments } from './describe';

/** One contribution: who made it, where (`visualView.registerNode`, `contributes.configuration`), and what it is called. */
export interface Contribution {
  readonly extension: string;
  readonly point: string;
  readonly label: string;
}

/**
 * The contributions of the extensions it `instrument`s, in the order they were made. Instrumenting wraps an
 * extension's `activate`: its context's namespaces become proxies that pass every call through and record each
 * `register…` call. Nothing else changes for the extension.
 */
export class ContributionLog {
  readonly #entries: Contribution[] = [];

  /** `extension`, recording what it declares and registers. */
  instrument(extension: TypstExtension): TypstExtension {
    return {
      id: extension.id,
      contributes: extension.contributes,
      activate: (context) => {
        for (const id of Object.keys(extension.contributes?.configuration?.properties ?? {})) {
          this.#entries.push({ extension: extension.id, point: 'contributes.configuration', label: id });
        }
        extension.activate(recordingContext(context, (point, args) => this.#entries.push({ extension: extension.id, point, label: describeArguments(args) })));
      },
    };
  }

  /** The contributions by extension, extensions in activation order. */
  byExtension(): ReadonlyMap<string, readonly Contribution[]> {
    const grouped = new Map<string, Contribution[]>();
    for (const entry of this.#entries) grouped.set(entry.extension, [...(grouped.get(entry.extension) ?? []), entry]);
    return grouped;
  }
}

type Recorder = (point: string, args: readonly unknown[]) => void;

/** `context` with each namespace that has `register…` methods replaced by a recording proxy. */
function recordingContext(context: ExtensionContext, record: Recorder): ExtensionContext {
  const entries = Object.entries(context).map(([key, value]) => [key, isNamespace(value) ? recordingNamespace(key, value, record) : value]);
  return Object.fromEntries(entries) as ExtensionContext;
}

/**
 * Passes everything through to `target` (methods called on it, so class instances with private fields work) and
 * records each `register…` call that returns.
 */
function recordingNamespace(name: string, target: object, record: Recorder): object {
  return new Proxy(target, {
    get(namespace, key) {
      const value: unknown = Reflect.get(namespace, key);
      if (typeof value !== 'function') return value;
      if (typeof key !== 'string' || !key.startsWith('register')) return value.bind(namespace);
      return (...args: unknown[]) => {
        const result: unknown = value.apply(namespace, args);
        record(`${name}.${key}`, args);
        return result;
      };
    },
  });
}

/** Whether `value` is an object with `register…` methods (own or inherited), found without calling any getter. */
function isNamespace(value: unknown): value is object {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const isMethod = (layer: object, key: string) => key.startsWith('register') && typeof Object.getOwnPropertyDescriptor(layer, key)?.value === 'function';
  for (let layer: object | null = value; layer && layer !== Object.prototype; layer = Object.getPrototypeOf(layer) as object | null) {
    const own = layer;
    if (Object.getOwnPropertyNames(own).some((key) => isMethod(own, key))) return true;
  }
  return false;
}
