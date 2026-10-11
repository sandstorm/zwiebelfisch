// A value as one short line of text, for the devtools' lists (an event's value, a contribution's arguments).
// See ../devtools.ts.

const MAX_TEXT = 60;
const MAX_LINE = 160;
const MAX_ITEMS = 4;

/**
 * `value` as one line: strings quoted (long ones cut), plain objects and arrays one level deep (`{ kind: "update",
 * path: "/main.typ" }`), class instances by their class (`TypstDocument {…}`), elements as `<svg>`, functions as `ƒ`.
 */
export function describeValue(value: unknown): string {
  return cut(describeAt(value, 0), MAX_LINE);
}

/** What a registration was given, by the names it is known by: short strings, an object's id / name / command / … and `priority`. */
export function describeArguments(args: readonly unknown[]): string {
  return args.flatMap((arg) => namesOf(arg)).join(' · ');
}

/** The keys that name a contribution, the first one present wins. */
const NAME_KEYS = ['id', 'name', 'command', 'viewType', 'label', 'title'] as const;

function namesOf(arg: unknown): string[] {
  if (typeof arg === 'string') return [shortText(arg)];
  if (typeof arg !== 'object' || arg === null || isElement(arg)) return [];
  const record = arg as Record<string, unknown>;
  const name = nameOf(record);
  // a toolbar item by its group: `insert/Table`
  const named = typeof record.group === 'string' ? `${record.group}/${name ?? ''}` : name;
  return [...(named === undefined ? [] : [named]), ...(typeof record.priority === 'number' ? [`priority ${record.priority}`] : [])];
}

/** A string argument: an id as it is, CSS or other long text by its length. */
function shortText(text: string): string {
  return text.length <= MAX_TEXT && !text.includes('\n') ? text : `(${text.length} characters)`;
}

function nameOf(record: Record<string, unknown>): string | undefined {
  const key = NAME_KEYS.find((name) => typeof record[name] === 'string');
  if (key) return String(record[key]);
  const action = record.action as Record<string, unknown> | undefined;
  return typeof action?.label === 'string' ? action.label : undefined;
}

function describeAt(value: unknown, depth: number): string {
  if (typeof value === 'string') return JSON.stringify(cut(value, MAX_TEXT));
  if (typeof value === 'function') return 'ƒ';
  if (typeof value !== 'object' || value === null) return String(value);
  return describeObject(value, depth);
}

function describeObject(value: object, depth: number): string {
  if (isElement(value)) return `<${value.nodeName.toLowerCase()}>`;
  if (Array.isArray(value)) return depth > 0 ? `[${value.length}]` : `[${listed(value.map((item) => describeAt(item, depth + 1)), value.length)}]`;
  const className = (Object.getPrototypeOf(value) as { constructor?: { name?: string } } | null)?.constructor?.name;
  if (className && className !== 'Object') return `${className} {…}`;
  if (depth > 0) return '{…}';
  const entries = Object.entries(value);
  return `{ ${listed(entries.map(([key, item]) => `${key}: ${describeAt(item, depth + 1)}`), entries.length)} }`;
}

function listed(items: string[], total: number): string {
  return [...items.slice(0, MAX_ITEMS), ...(total > MAX_ITEMS ? ['…'] : [])].join(', ');
}

function isElement(value: object): value is { nodeName: string } {
  return 'nodeType' in value && 'nodeName' in value && typeof value.nodeName === 'string';
}

function cut(text: string, max: number): string {
  const line = text.replace(/\n/g, '⏎');
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
