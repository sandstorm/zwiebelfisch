// What each extension contributes, recorded as it activates (and later). See devtools in ../devtools.ts.
import { EventEmitter, type Event } from '../../../core/event-emitter/event-emitter';
import type { ExtensionContext, Extension } from '../../../hosts/extension-host/extension-host';
import { describeContribution, describeSetting, type Description } from './contribution-points';
import { formatValue } from '../model/describe';

/**
 * The contributions of the extensions it `instrument`s, in the order they were made: every `register…` call on their
 * contexts' namespaces and the settings and keys they declare, each described in its point's terms, with where it was
 * made and whether it was disposed since. Instrumenting wraps an extension's `activate`; nothing else changes for the
 * extension.
 */
export class ContributionLog {
  readonly #entries: (Contribution & { disposed: boolean })[] = [];
  readonly #changed = new EventEmitter<void>();
  /** Fires on a contribution made or disposed after activation. */
  readonly onDidChange: Event<void> = this.#changed.event;

  /** `extension`, recording what it declares and registers. */
  instrument(extension: Extension): Extension {
    return {
      id: extension.id,
      contributes: extension.contributes,
      activate: (context) => {
        let activating = true;
        for (const [id, property] of Object.entries(extension.contributes?.configuration?.properties ?? {})) {
          this.#entries.push({ extension: extension.id, point: 'contributes.configuration', ...describeSetting(id, property), arguments: formatValue(property).text, location: undefined, late: false, disposed: false });
        }
        for (const binding of extension.contributes?.keybindings ?? []) {
          const description = describeContribution('contributes.keybindings', [binding.key, binding.command]);
          this.#entries.push({ extension: extension.id, point: 'contributes.keybindings', ...description, arguments: formatValue(binding).text, location: undefined, late: false, disposed: false });
        }
        const record: Recorder = (point, args, location) => {
          const entry = { extension: extension.id, point, ...describeContribution(point, args), arguments: formatValue(args).text, location, late: !activating, disposed: false };
          this.#entries.push(entry);
          if (entry.late) this.#changed.fire();
          return () => {
            entry.disposed = true;
            this.#changed.fire();
          };
        };
        try {
          extension.activate(recordingContext(context, record));
        } finally {
          activating = false;
        }
      },
    };
  }

  /** The contributions by extension, extensions in activation order, each's in registration order. */
  byExtension(): ReadonlyMap<string, readonly Contribution[]> {
    return group(this.#entries, (entry) => entry.extension);
  }

  /**
   * The contributions by contribution point (points by name), each point's in the order its host resolves them
   * (`rank`: by priority, order, group; else registration order): who competes with whom.
   */
  byPoint(): ReadonlyMap<string, readonly Contribution[]> {
    const points = [...group(this.#entries, (entry) => entry.point)].sort(([a], [b]) => a.localeCompare(b));
    return new Map(points.map(([point, entries]) => [point, [...entries].sort((a, b) => compareRanks(a.rank ?? [], b.rank ?? []))]));
  }
}

/** One contribution: who made it, where (`visualEditor.registerNode`, `contributes.configuration`), and what it is. */
export interface Contribution extends Description {
  readonly extension: string;
  readonly point: string;
  /** What the registration was given, pretty-printed. */
  readonly arguments: string;
  /** The line of code that registered it (a stack frame: file, line, column), if the browser tells. */
  readonly location: string | undefined;
  /** Made after its extension's `activate` returned (in a listener, a later step). */
  readonly late: boolean;
  /** Disposed since: no longer in effect. */
  readonly disposed: boolean;
}

/** The second frame of `stack` (V8: `    at f (url:1:2)`, Firefox and Safari: `f@url:1:2`), without the frame's function. */
export function callerOf(stack: string | undefined): string | undefined {
  const frames = (stack ?? '').split('\n').filter((line) => /:\d+:\d+\)?\s*$/.test(line));
  const frame = frames[1]?.trim();
  if (!frame) return undefined;
  const location = /\(([^()]+)\)$/.exec(frame)?.[1] ?? frame.replace(/^at /, '').replace(/^[^@]*@/, '');
  // the dev server's cache busting (`?t=…`, `?v=…`) says nothing about where
  return location.replace(/\?[^:]*(?=:\d+:\d+$)/, '');
}

/** Records a registration made through `point` with `args`; returns what to call when it is disposed. */
type Recorder = (point: string, args: readonly unknown[], location: string | undefined) => () => void;

/** `context` with each namespace that has `register…` methods replaced by a recording proxy. */
function recordingContext(context: ExtensionContext, record: Recorder): ExtensionContext {
  const entries = Object.entries(context).map(([key, value]) => [key, isNamespace(value) ? recordingNamespace(key, value, record) : value]);
  return Object.fromEntries(entries) as ExtensionContext;
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

/**
 * Passes everything through to `target` (methods called on it, so class instances with private fields work) and
 * records each `register…` call that returns, its result's `dispose` reporting the disposal.
 */
function recordingNamespace(name: string, target: object, record: Recorder): object {
  return new Proxy(target, {
    get(namespace, key) {
      const value: unknown = Reflect.get(namespace, key);
      if (typeof value !== 'function') return value;
      if (typeof key !== 'string' || !key.startsWith('register')) return value.bind(namespace);
      return function register(...args: unknown[]) {
        // the frame after this function's: the extension's call
        const location = callerOf(new Error().stack);
        const result: unknown = value.apply(namespace, args);
        return reportingDisposal(result, record(`${name}.${key}`, args, location));
      };
    },
  });
}

/** `result`, with its `dispose` (if it has one) also calling `disposed`, once. */
function reportingDisposal(result: unknown, disposed: () => void): unknown {
  if (typeof result !== 'object' || result === null || typeof (result as { dispose?: unknown }).dispose !== 'function') return result;
  // a frozen `dispose` cannot be answered with another function (a proxy's invariant)
  const own = Object.getOwnPropertyDescriptor(result, 'dispose');
  if (own && !own.configurable && !own.writable) return result;
  let reported = false;
  return new Proxy(result, {
    get(target, key) {
      const value: unknown = Reflect.get(target, key);
      if (typeof value !== 'function') return value;
      if (key !== 'dispose') return value.bind(target);
      return (...args: unknown[]) => {
        if (!reported) disposed();
        reported = true;
        return value.apply(target, args);
      };
    },
  });
}

function group(entries: readonly Contribution[], key: (entry: Contribution) => string): Map<string, Contribution[]> {
  const grouped = new Map<string, Contribution[]>();
  for (const entry of entries) grouped.set(key(entry), [...(grouped.get(key(entry)) ?? []), entry]);
  return grouped;
}

function compareRanks(a: readonly (string | number)[], b: readonly (string | number)[]): number {
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    const [x, y] = [a[index], b[index]];
    if (x === y) continue;
    return typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
  }
  return 0;
}
