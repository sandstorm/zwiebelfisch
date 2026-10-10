// Typst syntax several extensions need, read from the Lezer syntax tree (codemirror-lang-typst): the file paths a
// text names (`#import`, `#include`, `image(…)`, `read(…)`, …), the reading order they give the project's files, and
// the change that imports a name (calculate-import-change.ts). Entry of core/typst-syntax/. See ARCHITECTURE.md,
// "File links".
// Why here: extensions never import each other, and this knowledge is about Typst, not about one feature. Only
// syntax: where a path leads (the project, the file's current path) and what following it does (open, create) is the
// document-links extension's, and showing links is the hosts' (`Workbench.registerDocumentLinkProvider`); applying
// a change is the caller's.
import type { SyntaxNode } from '@lezer/common';
import { typstParser } from 'codemirror-lang-typst/lezer';
import { PathReference, ProjectPath } from '../paths/paths';

export { calculateImportChange, type ImportRequest } from './calculate-import-change';

/** What names the path: `#import`, `#include`, or the function whose first argument it is. */
export type PathCall = 'import' | 'include' | 'image' | 'read' | 'json' | 'csv' | 'yaml' | 'toml' | 'xml' | 'cbor' | 'bibliography';

/** A file path written in Typst source, as written (relative to that file, or `/` from the project root). */
export interface PathInSource {
  /** The path as Typst reads it (escapes decoded). */
  path: PathReference;
  /** The range of the path's text (inside the quotes). */
  from: number;
  to: number;
  call: PathCall;
}

/**
 * The file paths `text` names, in order: the string of `#import "…"` / `#include "…"` and the first positional
 * argument of `image`, `read`, `json`, `csv`, `yaml`, `toml`, `xml`, `cbor` and `bibliography` (each string of a
 * bibliography array). Package imports, empty strings, computed paths and methods (`image.decode`) are left out.
 * `from` / `to` look at a part only.
 */
export function findFilePaths(text: string, options: { from?: number; to?: number } = {}): PathInSource[] {
  const found: PathInSource[] = [];
  typstParser.parse(text).iterate({
    from: options.from,
    to: options.to,
    enter: (node) => {
      for (const path of pathsOf(node.node, text)) found.push(path);
    },
  });
  return found;
}

/** The text of the Typst file `path`; undefined when there is none (missing, or not a Typst file). */
export type ReadText = (path: ProjectPath) => string | undefined;

/**
 * The main file, then every file it `#include`s, depth first, in the order
 * Typst reads them (a nested include comes right after the text before it).
 * Missing files, imports, a file included a second time and include cycles
 * are left out. Empty when there is no main file.
 */
export function readingOrder(read: ReadText, main: ProjectPath): ProjectPath[] {
  const order: ProjectPath[] = [];
  const visit = (path: ProjectPath) => {
    const text = read(path);
    if (text === undefined || order.includes(path)) return;
    order.push(path);
    for (const reference of findFilePaths(text)) {
      if (reference.call !== 'include') continue;
      const target = ProjectPath.resolve(path, reference.path);
      if (target !== null) visit(target);
    }
  };
  visit(main);
  return order;
}

/**
 * The files read before and after `path` (null at the end), or null when
 * `path` is the main file or not included at all.
 */
export function neighbours(read: ReadText, main: ProjectPath, path: ProjectPath): { previous: ProjectPath; next: ProjectPath | null } | null {
  const order = readingOrder(read, main);
  const index = order.indexOf(path);
  if (index <= 0) return null;
  return { previous: order[index - 1], next: order[index + 1] ?? null };
}

/** Functions whose first positional argument is a file path. */
const CALLS = new Set<PathCall>(['image', 'read', 'json', 'csv', 'yaml', 'toml', 'xml', 'cbor', 'bibliography']);

function pathsOf(node: SyntaxNode, text: string): PathInSource[] {
  if (node.name === 'ModuleImport' || node.name === 'ModuleInclude') return importPaths(node, text);
  return node.name === 'FuncCall' ? callPaths(node, text) : [];
}

/** `import "…"` / `include "…"`. */
function importPaths(node: SyntaxNode, text: string): PathInSource[] {
  const string = node.getChild('Str');
  return string ? onlyFiles([pathIn(string, text, node.name === 'ModuleImport' ? 'import' : 'include')]) : [];
}

/** `image("…")`, `bibliography(("…", "…"))`, …: the first positional argument. */
function callPaths(node: SyntaxNode, text: string): PathInSource[] {
  const callee = node.firstChild;
  const name = callee?.name === 'Ident' ? (text.slice(callee.from, callee.to) as PathCall) : null;
  const first = name && CALLS.has(name) ? firstPositional(node.getChild('Args')) : null;
  if (!name || !first) return [];
  const strings = first.name === 'Array' && name === 'bibliography' ? first.getChildren('Str') : first.name === 'Str' ? [first] : [];
  return onlyFiles(strings.map((string) => pathIn(string, text, name)));
}

const SYNTAX = new Set(['LeftParen', 'RightParen', 'Comma', 'Space', 'LineComment', 'BlockComment']);

function firstPositional(args: SyntaxNode | null): SyntaxNode | null {
  for (let child = args?.firstChild ?? null; child; child = child.nextSibling) {
    if (!SYNTAX.has(child.name)) return child.name === 'Named' || child.name === 'Spread' ? null : child;
  }
  return null;
}

function pathIn(string: SyntaxNode, text: string, call: PathCall): PathInSource {
  const from = string.from + 1;
  const to = Math.max(from, text[string.to - 1] === '"' && string.to - 1 > string.from ? string.to - 1 : string.to);
  return { path: PathReference.of(unescape(text.slice(from, to))), from, to, call };
}

/** Not packages, not empty. */
function onlyFiles(paths: PathInSource[]): PathInSource[] {
  return paths.filter((found) => found.path !== '' && !found.path.startsWith('@'));
}

const ESCAPES: Record<string, string> = { n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\' };

function unescape(raw: string): string {
  return raw.replace(/\\(u\{([0-9a-fA-F]+)\}|.)/g, (all, escape: string, hex?: string) =>
    hex ? String.fromCodePoint(parseInt(hex, 16)) : (ESCAPES[escape] ?? all),
  );
}
