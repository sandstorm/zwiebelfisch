// Values as text for the devtools: pretty-printed over several lines (an event's value, a contribution's arguments),
// or as one short line (a document node's attributes). See ../devtools.ts.

/** How much of a value is shown: nesting levels opened, entries per object, characters per string. */
export interface Limits {
  readonly depth: number;
  readonly items: number;
  readonly text: number;
}

/** For values read in full (events, a contribution's arguments): several levels deep. */
const FULL: Limits = { depth: 4, items: 25, text: 2000 };
/** For one line: one level deep, short strings. */
const ONE_LINE: Limits = { depth: 1, items: 4, text: 60 };

/** The longest line `formatValue` gives as `line`; the longest object it keeps on one line in `text`. */
const MAX_LINE = 160;
const MAX_INLINE_OBJECT = 72;
/** At most this many values are looked at per formatting, so a large structure stays cheap. */
const BUDGET = 600;

/** A value as text: `line` in one line (shortened with `…` where too long), `text` pretty-printed, indented. */
export interface FormattedValue {
  readonly line: string;
  readonly text: string;
}

/**
 * `value` as text, JSON-like: strings quoted, plain objects, arrays, maps and sets opened `limits.depth` levels deep;
 * class instances by their class and their public fields and getters (`DocumentEditor { viewType: "visualEditor",
 * selection: { from: 0, to: 3 } }`), methods left out; elements as `<svg>`, functions as `ƒ name`, bytes by their length.
 */
export function formatValue(value: unknown, limits: Limits = FULL): FormattedValue {
  const shape = new Shaper(limits).shape(value, 0, new Set());
  return { line: cut(inline(shape), MAX_LINE), text: pretty(shape, '') };
}

/** `value` in one short line, one level deep: `{ kind: "update", path: "/main.typ", change: {…} }`. */
export function describeValue(value: unknown): string {
  return formatValue(value, ONE_LINE).line;
}

/** What a registration was given, by the names it is known by: short strings, an object's id / name / command / … and `priority`. */
export function describeArguments(args: readonly unknown[]): string {
  return args.flatMap((arg) => namesOf(arg)).join(' · ');
}

/** What a function or an object is called: a function's name, a class instance's class; undefined: anonymous. */
export function nameOf(value: unknown): string | undefined {
  if (typeof value === 'function') return value.name || undefined;
  return typeof value === 'object' && value !== null ? className(value) : undefined;
}

/** A value laid out: text, or an object's entries (keyed, or a list's items) between brackets. */
type Shape =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'entries'; readonly prefix: string; readonly brackets: '{}' | '[]'; readonly entries: readonly Entry[]; readonly more: number };

interface Entry {
  readonly key?: string;
  readonly value: Shape;
}

const text = (value: string): Shape => ({ kind: 'text', text: value });

class Shaper {
  #budget = BUDGET;

  constructor(private readonly limits: Limits) {}

  shape(value: unknown, depth: number, seen: Set<object>): Shape {
    this.#budget--;
    if (typeof value === 'string') return text(JSON.stringify(cutText(value, this.limits.text)));
    if (typeof value === 'function') return text(value.name ? `ƒ ${value.name}` : 'ƒ');
    if (typeof value === 'bigint') return text(`${value}n`);
    if (typeof value !== 'object' || value === null) return text(String(value));
    if (seen.has(value)) return text('[circular]');
    return this.#object(value, depth, seen);
  }

  #object(value: object, depth: number, seen: Set<object>): Shape {
    const leaf = leafOf(value);
    if (leaf !== undefined) return text(leaf);
    const { prefix, brackets, size } = containerOf(value);
    if (depth >= this.limits.depth || this.#budget <= 0) {
      const body = brackets === '[]' ? `[…${size ?? ''}]` : '{…}';
      return text(prefix ? `${prefix} ${body}` : body);
    }
    const all = entriesOf(value);
    const shown = all.slice(0, Math.max(0, Math.min(this.limits.items, this.#budget)));
    const inner = new Set(seen).add(value);
    const entries = shown.map(([key, item]) => ({ key, value: this.shape(item, depth + 1, inner) }));
    return { kind: 'entries', prefix, brackets, entries, more: all.length - shown.length };
  }
}

/** How an object is written around its entries: `Map(2) {…}`, `Set(2) […]`, `[…]`, `DocumentEditor {…}`, `{…}`. */
function containerOf(value: object): { prefix: string; brackets: '{}' | '[]'; size?: number } {
  if (Array.isArray(value)) return { prefix: '', brackets: '[]', size: value.length };
  if (value instanceof Set) return { prefix: `Set(${value.size})`, brackets: '[]', size: value.size };
  if (value instanceof Map) return { prefix: `Map(${value.size})`, brackets: '{}', size: value.size };
  return { prefix: className(value) ?? '', brackets: '{}' };
}

/** Objects shown as one piece of text: elements, bytes, dates, errors, regular expressions. */
function leafOf(value: object): string | undefined {
  if (isElement(value)) return `<${value.nodeName.toLowerCase()}>`;
  if (ArrayBuffer.isView(value)) return `${className(value)}(${value.byteLength} bytes)`;
  if (value instanceof ArrayBuffer) return `ArrayBuffer(${value.byteLength} bytes)`;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (value instanceof RegExp) return String(value);
  if (value instanceof Promise) return 'Promise';
  return undefined;
}

/** The entries of an object as shown: an array's items, a map's or set's entries, an object's public fields and getters. */
function entriesOf(value: object): [string | undefined, unknown][] {
  if (Array.isArray(value)) return value.map((item) => [undefined, item]);
  if (value instanceof Map) return [...value].map(([key, item]) => [describeValue(key), item]);
  if (value instanceof Set) return [...value].map((item) => [undefined, item]);
  if (className(value) === undefined) return Object.entries(value).filter(([key]) => isPublic(key));
  // a class instance: its functions are its methods; its getters (`selection`) are read once
  const fields = Object.entries(value).filter(([key, item]) => isPublic(key) && typeof item !== 'function');
  const own = new Set(fields.map(([key]) => key));
  return [...fields, ...getterValues(value).filter(([key]) => !own.has(key))];
}

/** The public getters of a class instance (its prototypes'), with their values but those that throw or are functions. */
function getterValues(value: object): [string, unknown][] {
  const getters = new Set<string>();
  for (let layer = Object.getPrototypeOf(value) as object | null; layer && layer !== Object.prototype; layer = Object.getPrototypeOf(layer) as object | null) {
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(layer))) if (descriptor.get && isPublic(key)) getters.add(key);
  }
  return [...getters].flatMap((key): [string, unknown][] => {
    try {
      const item: unknown = Reflect.get(value, key);
      return typeof item === 'function' ? [] : [[key, item]];
    } catch {
      // a getter that needs a state the object is not in
      return [];
    }
  });
}

function isPublic(key: string): boolean {
  return !key.startsWith('_') && key !== 'constructor';
}

/** The class of a class instance; undefined for plain objects and arrays. */
function className(value: object): string | undefined {
  const prototype = Object.getPrototypeOf(value) as { constructor?: { name?: string } } | null;
  const name = prototype?.constructor?.name;
  return prototype === null || name === 'Object' || name === 'Array' || !name ? undefined : name;
}

function inline(shape: Shape): string {
  if (shape.kind === 'text') return shape.text;
  const items = shape.entries.map((entry) => (entry.key === undefined ? inline(entry.value) : `${entry.key}: ${inline(entry.value)}`));
  if (shape.more > 0) items.push('…');
  const [open, close] = shape.brackets;
  const body = items.length === 0 ? `${open}${close}` : shape.brackets === '{}' ? `{ ${items.join(', ')} }` : `[${items.join(', ')}]`;
  return shape.prefix ? `${shape.prefix} ${body}` : body;
}

/** `shape` over several lines, two spaces per level; short objects of plain values stay on one line. */
function pretty(shape: Shape, indent: string): string {
  if (shape.kind === 'text') return shape.text;
  const flat = inline(shape);
  if (flat.length <= MAX_INLINE_OBJECT && shape.entries.every((entry) => entry.value.kind === 'text' && entry.value.text.length <= 40)) return flat;
  const inner = `${indent}  `;
  const lines = shape.entries.map((entry) => `${inner}${entry.key === undefined ? '' : `${entry.key}: `}${pretty(entry.value, inner)}`);
  if (shape.more > 0) lines.push(`${inner}… ${shape.more} more`);
  const [open, close] = shape.brackets;
  return `${shape.prefix ? `${shape.prefix} ` : ''}${open}\n${lines.join(',\n')}\n${indent}${close}`;
}

/** The keys that name a contribution, the first one present wins. */
const NAME_KEYS = ['id', 'name', 'command', 'viewType', 'label', 'title'] as const;

function namesOf(arg: unknown): string[] {
  if (typeof arg === 'string') return [arg.length <= ONE_LINE.text && !arg.includes('\n') ? arg : `(${arg.length} characters)`];
  if (typeof arg !== 'object' || arg === null || isElement(arg)) return [];
  const record = arg as Record<string, unknown>;
  const key = NAME_KEYS.find((name) => typeof record[name] === 'string');
  const name = key ? String(record[key]) : undefined;
  return [...(name === undefined ? [] : [name]), ...(typeof record.priority === 'number' ? [`priority ${record.priority}`] : [])];
}

function isElement(value: object): value is { nodeName: string } {
  return 'nodeType' in value && 'nodeName' in value && typeof value.nodeName === 'string';
}

/** `value` cut to `max` characters, saying how long it was. */
function cutText(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}… (${value.length} characters)` : value;
}

/** `line` with its line breaks as ⏎, cut to `max` characters. */
function cut(line: string, max: number): string {
  const flat = line.replace(/\n/g, '⏎');
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
