// Path references: the file paths a Typst text names (imports, includes, image/read/data calls) and what a
// link to one of them offers. See project.ts and ARCHITECTURE.md, "File links".
import type { SyntaxNode, Tree } from '@lezer/common';
import { typstParser } from 'codemirror-lang-typst/lezer';
import { displayName, fileKind } from './paths';

/** What names the path: `#import`, `#include`, or the function whose first argument it is. */
export type PathCall = 'import' | 'include' | 'image' | 'read' | 'json' | 'csv' | 'yaml' | 'toml' | 'xml' | 'cbor' | 'bibliography';

/** A file path written in Typst source, as written (relative to that file, or `/` from the project root). */
export interface PathReference {
  /** The path as Typst reads it (escapes decoded). */
  path: string;
  /** The range of the path's text (inside the quotes). */
  from: number;
  to: number;
  call: PathCall;
}

/** Functions whose first positional argument is a file path. */
const CALLS = new Set<PathCall>(['image', 'read', 'json', 'csv', 'yaml', 'toml', 'xml', 'cbor', 'bibliography']);

/**
 * The file paths `text` refers to: the string of `#import "…"` / `#include
 * "…"` and the first positional argument of `image`, `read`, `json`, `csv`,
 * `yaml`, `toml`, `xml`, `cbor` and `bibliography` (also each string of a
 * bibliography array). Package imports (`@preview/…`), empty strings,
 * computed paths and methods (`image.decode`) are left out. Pass the `tree`
 * when it is already parsed (an editor's syntax tree), and `from`/`to` to
 * look at a part of the text only.
 */
export function findPathReferences(text: string, options: { tree?: Tree; from?: number; to?: number } = {}): PathReference[] {
  const tree = options.tree ?? typstParser.parse(text);
  const found: PathReference[] = [];
  tree.iterate({
    from: options.from,
    to: options.to,
    enter: (node) => {
      for (const reference of referencesOf(node.node, text)) found.push(reference);
    },
  });
  return found;
}

/** The path reference whose string (quotes included) holds `offset`, or null. */
export function pathReferenceAt(text: string, offset: number, tree?: Tree): PathReference | null {
  const candidates = findPathReferences(text, { tree, from: Math.max(0, offset - 1), to: offset + 1 });
  return candidates.find((r) => r.from - 1 <= offset && offset <= r.to + 1) ?? null;
}

/**
 * The project as a Typst file sees it: where its paths point, and opening or
 * creating those files. One per document (paths resolve from its current path).
 */
export interface FileLinks {
  /** The project path `reference` (as written in this document) points to; null when it leaves the project. */
  resolve(reference: string): string | null;
  exists(path: string): boolean;
  /** Shows the file (like the widget's `open`). */
  open(path: string): void;
  /** Creates the empty Typst file `path` and opens it; resolves to why that was refused, or null. */
  create(path: string): Promise<string | null>;
}

/** Where a link goes and what it can do: open an existing file, or create a missing Typst file. */
export interface LinkTarget {
  path: string;
  /** The path as shown to people. */
  name: string;
  exists: boolean;
  /** Missing, and a Typst file that can be created empty. */
  creatable: boolean;
}

/** What following `reference` would do; null when it points outside the project. */
export function describeLink(links: FileLinks, reference: string): LinkTarget | null {
  const path = links.resolve(reference);
  if (path === null) return null;
  const exists = links.exists(path);
  return { path, name: displayName(path), exists, creatable: !exists && fileKind(path) === 'typst' };
}

function referencesOf(node: SyntaxNode, text: string): PathReference[] {
  if (node.name === 'ModuleImport' || node.name === 'ModuleInclude') return importReferences(node, text);
  return node.name === 'FuncCall' ? callReferences(node, text) : [];
}

/** `import "…"` / `include "…"`. */
function importReferences(node: SyntaxNode, text: string): PathReference[] {
  const string = node.getChild('Str');
  return string ? onlyFiles([reference(string, text, node.name === 'ModuleImport' ? 'import' : 'include')]) : [];
}

/** `image("…")`, `bibliography(("…", "…"))`, …: the first positional argument. */
function callReferences(node: SyntaxNode, text: string): PathReference[] {
  const callee = node.firstChild;
  const name = callee?.name === 'Ident' ? (text.slice(callee.from, callee.to) as PathCall) : null;
  const first = name && CALLS.has(name) ? firstPositional(node.getChild('Args')) : null;
  if (!name || !first) return [];
  const strings = first.name === 'Array' && name === 'bibliography' ? first.getChildren('Str') : first.name === 'Str' ? [first] : [];
  return onlyFiles(strings.map((string) => reference(string, text, name)));
}

const SYNTAX = new Set(['LeftParen', 'RightParen', 'Comma', 'Space', 'LineComment', 'BlockComment']);

function firstPositional(args: SyntaxNode | null): SyntaxNode | null {
  for (let child = args?.firstChild ?? null; child; child = child.nextSibling) {
    if (!SYNTAX.has(child.name)) return child.name === 'Named' || child.name === 'Spread' ? null : child;
  }
  return null;
}

function reference(string: SyntaxNode, text: string, call: PathCall): PathReference {
  const from = string.from + 1;
  const to = Math.max(from, text[string.to - 1] === '"' && string.to - 1 > string.from ? string.to - 1 : string.to);
  return { path: unescape(text.slice(from, to)), from, to, call };
}

/** Not packages, not empty. */
function onlyFiles(references: PathReference[]): PathReference[] {
  return references.filter((r) => r.path !== '' && !r.path.startsWith('@'));
}

const ESCAPES: Record<string, string> = { n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\' };

function unescape(raw: string): string {
  return raw.replace(/\\(u\{([0-9a-fA-F]+)\}|.)/g, (all, escape: string, hex?: string) =>
    hex ? String.fromCodePoint(parseInt(hex, 16)) : (ESCAPES[escape] ?? all),
  );
}
