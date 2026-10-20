// What a contribution is, in its contribution point's own terms. See ContributionLog in contributions.ts.
import { flattenExtensions, getExtensionField, type AnyExtension } from '@tiptap/core';
import { describeArguments, describeValue, nameOf } from '../model/describe';

/**
 * `args` of a registration through `point` (`visualEditor.registerNode`), described; the generic summary for unknown points.
 *
 * A node by its name, Tiptap priority and the Typst it parses, a keybinding as `Ctrl+Alt+M → comments.addComment`, a
 * setting by its type and default. The arguments are read by their shape, as any extension would see them.
 */
export function describeContribution(point: string, args: readonly unknown[]): Description {
  const describe = POINTS[point];
  if (describe) {
    try {
      return describe(args as Arguments);
    } catch {
      // arguments of a shape this does not know: the generic summary
    }
  }
  return { title: describeArguments(args) || '(no name)', details: [] };
}

/** A contribution described: what it is (`heading`), facts about it, and where it stands among its point's. */
export interface Description {
  /** What it is called there (a node's name, a command's id, a menu item's title). */
  readonly title: string;
  /** Short facts: `priority 110`, `parses Heading`, `in insert`, `default "auto"`. */
  readonly details: readonly string[];
  /**
   * Its place among the contributions of its point, as the host orders them (compared item by item, lower first):
   * a priority negated (higher first), an `order`, a group's name. None: registration order.
   */
  readonly rank?: readonly (string | number)[];
}

/** A setting an extension declares (`contributes.configuration`): its id, type and default. */
export function describeSetting(id: string, property: unknown): Description {
  const { type, default: value, enum: values } = record(property);
  const types = Array.isArray(type) ? type.join(' | ') : String(type);
  return { title: id, details: [types, `default ${describeValue(value)}`, ...(Array.isArray(values) ? [`one of ${values.map((item) => describeValue(item)).join(', ')}`] : [])] };
}

const POINTS: Readonly<Record<string, Describer>> = {
  'contributes.configuration': ([id, property]) => describeSetting(String(id), property),
  'commands.registerCommand': ([id]) => ({ title: String(id), details: [] }),
  'contributes.keybindings': ([key, command]) => ({ title: `${String(key)} → ${String(command)}`, details: [] }),
  'visualEditor.registerNode': ([spec]) => typstSpec(spec),
  'visualEditor.registerMark': ([spec]) => typstSpec(spec),
  'visualEditor.registerTiptapExtension': ([provider]) => named(provider, 'Tiptap extensions'),
  'visualEditor.registerSubmenu': ([submenu]) => {
    const { id, label, parent, group, order } = record(submenu);
    const place = typeof group === 'string' && group ? group : '';
    return {
      title: String(id),
      details: [`"${String(label)}"`, `in ${String(parent)}`, ...optional(place || undefined, (value) => `group ${value}`), `order ${num(order, 0)}`],
      rank: [String(parent), place === 'navigation' ? 0 : 1, place, num(order, 0)],
    };
  },
  'visualEditor.registerFloatingBar': ([bar]) => {
    const { id, label, order } = record(bar);
    return { title: String(id), details: [`"${String(label)}"`, `order ${num(order, 0)}`], rank: [num(order, 0)] };
  },
  'visualEditor.registerCompletionItemProvider': ([provider, trigger]) => {
    const { char, allowedPrefixes } = record(trigger);
    const prefixes = Array.isArray(allowedPrefixes) ? [`after ${allowedPrefixes.map((prefix) => JSON.stringify(prefix)).join(', ')}`] : [];
    return { title: `trigger "${String(char)}"`, details: [...optional(nameOf(provider), String), ...prefixes], rank: [String(char)] };
  },
  'visualEditor.registerHighlightProvider': ([provider]) => named(provider, 'highlight provider'),
  'visualEditor.registerRawBoxRenderer': ([provider, options]) => prioritized(named(provider, 'renderer'), record(options).priority),
  'visualEditor.registerRawBoxExtension': ([provider]) => named(provider, 'raw box extension'),
  'sourceEditor.registerCodeMirrorExtension': ([selector, extension]) => {
    const { language, editor } = record(selector);
    return { ...named(extension, 'CodeMirror extensions'), details: [`language ${String(language ?? '*')}`, `editor ${String(editor ?? '*')}`] };
  },
  'window.registerStyleSheet': ([css]) => ({ title: 'style sheet', details: [size(String(css))] }),
  'window.registerSidePanel': ([id, options]) => {
    const { label, side, order } = record(options);
    const where = side === 'right' ? 'right' : 'left';
    return { title: String(id), details: [`"${String(label)}"`, where, `order ${num(order, 0)}`], rank: [where, num(order, 0)] };
  },
  'window.registerEditorFrame': () => ({ title: 'editor frame', details: [] }),
  'window.registerMenuItem': ([menuId, item]) => {
    const { command, title, group, order, keybinding } = record(item);
    const place = typeof group === 'string' && group ? group : '';
    return {
      title: typeof title === 'string' ? title : String(command),
      details: [`menu ${String(menuId)}`, ...optional(place || undefined, (value) => `group ${value}`), `order ${num(order, 0)}`, `→ ${String(command)}`, ...optional(keybinding, String)],
      // VS Code's menus: `navigation` first, the other groups by name
      rank: [String(menuId), place === 'navigation' ? 0 : 1, place, num(order, 0)],
    };
  },
  'window.registerStatusBarItem': ([element, placement]) => {
    const { alignment, priority } = record(placement);
    const text = record(element).textContent;
    return {
      title: typeof text === 'string' && text.trim() ? text.trim() : `<${String(record(element).nodeName ?? 'element').toLowerCase()}>`,
      details: [String(alignment), `priority ${num(priority, 0)}`],
      // left items first; within a side the higher priority further left
      rank: [alignment === 'left' ? 0 : 1, -num(priority, 0)],
    };
  },
  'window.registerCustomEditorProvider': ([viewType, , options]) => {
    const { displayName, filenamePattern, priority = 'default' } = record(options);
    // who opens a file: the ranked editors by priority, then the fallback, then those only chosen ('option')
    const role = priority === 'fallback' ? 1 : priority === 'option' ? 2 : 0;
    const value = typeof priority === 'number' ? priority : DEFAULT_PRIORITY;
    return { title: String(viewType), details: [`"${String(displayName)}"`, String(filenamePattern), `priority ${String(priority)}`], rank: [role, -value] };
  },
  'window.registerFileDecorationProvider': ([provider]) => named(provider, 'file decorations'),
  'languages.registerDocumentLinkProvider': ([selector, provider, options]) => {
    const languages = [selector].flat().map((filter) => String(record(filter).language ?? '*'));
    return prioritized({ ...named(provider, 'document links'), details: [`language ${languages.join(', ')}`] }, record(options).priority);
  },
  'languages.registerDocumentPasteEditProvider': ([selector, provider, metadata, options]) => {
    const languages = [selector].flat().map((filter) => String(record(filter).language ?? '*'));
    const { providedPasteEditKinds: kinds } = record(metadata);
    return prioritized({ ...named(provider, 'paste edits'), details: [`language ${languages.join(', ')}`, `kinds ${Array.isArray(kinds) && kinds.length > 0 ? kinds.join(', ') : '(resolves)'}`] }, record(options).priority);
  },
  'preview.registerRenderer': ([renderer]) => {
    const { id, label, output } = record(renderer);
    return { title: String(id), details: [`"${String(label)}"`, `output ${String(output)}`] };
  },
  'preview.registerPdfExportOption': ([option]) => {
    const { id, label, default: value } = record(option);
    return { title: String(id), details: [`"${String(label)}"`, `default ${String(value)}`] };
  },
  'preview.registerViewOption': ([option]) => {
    const { id, label, default: value } = record(option);
    return { title: String(id), details: [`"${String(label)}"`, `default ${String(value)}`] };
  },
  'scm.registerSourceControl':([sourceControl]) => {
    const { id, label } = record(sourceControl);
    return { title: String(id), details: [`"${String(label)}"`] };
  },
};

type Describer = (args: Arguments) => Description;

// The arguments, read by shape: each describer picks what it knows.
type Arguments = readonly [unknown?, unknown?, unknown?, unknown?];

/** A node or mark spec: its name, its Tiptap extension's priority, the Typst syntax and calls it parses. */
function typstSpec(spec: unknown): Description {
  const { name, tiptap, typst, view } = record(spec);
  const { parseTypst } = record(typst);
  const { syntaxNodes, calls } = record(parseTypst);
  const priority = tiptap ? tiptapPriority(tiptap as AnyExtension, String(name)) : undefined;
  const details = [
    tiptap ? `priority ${priority}` : 'type made by another spec',
    ...keys(syntaxNodes).map((node) => `parses ${node}`),
    ...keys(calls).map((call) => (call === '*' ? 'parses any call' : `parses #${call}(..)`)),
    ...optional(record(view).box, (box) => `${String(box)} box`),
  ];
  return { title: String(name), details, rank: [-(priority ?? DEFAULT_PRIORITY)] };
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/**
 * The Tiptap priority of node or mark type `name`, as Tiptap resolves it: of the extension of that name among
 * `extension` and those it adds (`addExtensions`: a spec's extension may bring several), its own or the one it
 * extends; else `extension`'s; default 100.
 */
function tiptapPriority(extension: AnyExtension, name: string): number {
  const all = flattenExtensions([extension]);
  const own = all.find((candidate) => candidate.name === name && candidate.type !== 'extension') ?? extension;
  return getExtensionField<number | undefined>(own, 'priority') ?? DEFAULT_PRIORITY;
}

/** Tiptap's default priority of an extension, and the hosts' of providers. */
const DEFAULT_PRIORITY = 100;

function keys(value: unknown): string[] {
  return Object.keys(record(value));
}

function optional<T>(value: T | undefined | null, show: (value: T) => string): string[] {
  return value === undefined || value === null ? [] : [show(value)];
}

/** A provider by its name (a named function, a class instance's class), else `fallback`. */
function named(provider: unknown, fallback: string): Description {
  return { title: nameOf(provider) ?? fallback, details: [] };
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' ? value : fallback;
}

function prioritized(description: Description, priority: unknown): Description {
  const value = num(priority, DEFAULT_PRIORITY);
  return { ...description, details: [...description.details, `priority ${value}`], rank: [-value] };
}

function size(text: string): string {
  return text.length < 1024 ? `${text.length} characters` : `${(text.length / 1024).toFixed(1)} kB`;
}
