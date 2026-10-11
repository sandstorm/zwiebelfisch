// Typst syntax several extensions need, read from the Lezer syntax tree (codemirror-lang-typst): the file paths a
// text names (`#import`, `#include`, `image(…)`, `read(…)`, …), the reading order they give the project's files, the
// change that imports a name (calculateImportChange), and reading syntax nodes, calls, string literals and
// embeddable code as the Visual view's specs do (children, calleeName, callArguments, namedArgument,
// trailingContent, hasOnlyArguments, withHash, isClosedContent, decodeString, quote, isEmbeddable, markupSource:
// plain functions over Lezer nodes, public for every extension). Entry of core/typst-syntax/.
// See docs/architecture/core.typ.
// Why here: extensions never import each other, and this knowledge is about Typst, not about one feature. Only
// syntax: where a path leads (the project, the file's current path) and what following it does (open, create) is the
// document-links extension's, and showing links is the hosts' (`languages.registerDocumentLinkProvider`); applying
// a change is the caller's.
import type { SyntaxNode } from '@lezer/common';
import { typstParser } from 'codemirror-lang-typst/lezer';
import { PathReference, ProjectPath } from '../paths/paths';
import type { TextChange } from '../typst-document/typst-document';

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
 * The files read before and after `path` (null at the end), or null when `path` is the main file or not included
 * at all. Typst reads the main file, then every file it `#include`s, depth first (a nested include comes right
 * after the text before it); imports, missing files, a file included a second time and include cycles add nothing.
 */
export function neighbours(read: ReadText, main: ProjectPath, path: ProjectPath): { previous: ProjectPath; next: ProjectPath | null } | null {
  const order = readingOrder(read, main);
  const index = order.indexOf(path);
  if (index <= 0) return null;
  return { previous: order[index - 1], next: order[index + 1] ?? null };
}

/** What to import, and how to recognise and write the module's import. */
export interface ImportRequest {
  /** The name to import, e.g. `margin-note`, `note`. */
  name: string;
  /** Whether an import's module string (its value, e.g. `@preview/drafting:0.2.2`, `styles.typ`) is the module. */
  matches(module: string): boolean;
  /** The text of a new import, added at the top when no import of the module can take the name (with its newline). */
  create(): string;
  /** Where the name is used: only imports ending before it count (an import binds names only after itself). Default: the end. */
  use?: number;
}

/**
 * Decides the change that makes `name` imported from the module in Typst
 * `text`, without applying it: the caller sends it through
 * `TypstDocument.change`, possibly merged with its own changes into one edit
 * (one undo step).
 *
 * Null when an import before `use` already brings it (by name or `*`); else
 * the name is added to the item list of the first such import of the module
 * (`: a, b` → `: a, b, name`; a bare `#import "m"` gets `: name`), or
 * `create()` goes at the top. Never a duplicate.
 */
export function calculateImportChange(text: string, request: ImportRequest): TextChange | null {
  const use = request.use ?? text.length;
  for (let node = typstParser.parse(text).topNode.firstChild; node && node.to <= use; node = node.nextSibling) {
    if (node.name !== 'ModuleImport' || !importsModule(text, node, request)) continue;
    const change = extend(text, node, request.name);
    if (change !== undefined) return change;
  }
  return insert(0, request.create());
}

// Reading Typst syntax (Lezer nodes of codemirror-lang-typst's grammar) as the Visual view's parse functions and
// toTypst functions need it. A call is the grammar's `FuncCall`: its callee (`Ident`, or `FieldAccess` for
// `table.header`) and its `Args`, which hold `(`, the arguments (`Named` for `key: value`), separators, `)` and the
// trailing content blocks `[..]`.

/** The children of `node`, in order. */
export function children(node: SyntaxNode): SyntaxNode[] {
  const result: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) result.push(child);
  return result;
}

/** The name of the function `call` (a `FuncCall`) calls: `table` of `table(..)`; '' if it is no plain name (`table.header(..)`). */
export function calleeName(call: SyntaxNode, source: string): string {
  const callee = call.firstChild;
  return callee?.name === 'Ident' ? source.slice(callee.from, callee.to) : '';
}

/**
 * The arguments in the parentheses of `call` (a `FuncCall`), in order: expressions and `Named` nodes (`key: value`),
 * comments too; separators and spaces left out. Empty without (closed) parentheses.
 */
export function callArguments(call: SyntaxNode): SyntaxNode[] {
  const args = call.getChild('Args');
  if (args?.firstChild?.name !== 'LeftParen' || !args.getChild('RightParen')) return [];
  const result: SyntaxNode[] = [];
  for (let arg = args.firstChild.nextSibling; arg && arg.name !== 'RightParen'; arg = arg.nextSibling) {
    if (arg.name !== 'Comma' && arg.name !== 'Space') result.push(arg);
  }
  return result;
}

/** The value of the named argument `name` of `call` (`[..]` of `caption: [..]`), or null if it has none. */
export function namedArgument(call: SyntaxNode, name: string, source: string): SyntaxNode | null {
  const named = callArguments(call).find((arg) => arg.name === 'Named' && arg.firstChild && source.slice(arg.firstChild.from, arg.firstChild.to) === name);
  return named?.lastChild ?? null;
}

/**
 * The content blocks after the parentheses of `call`, or all of its arguments without parentheses: `[a]`, `[b]` of
 * `#f(..)[a][b]`, none of `#f(..)`. Null if they, or the parentheses, are not closed.
 */
export function trailingContent(call: SyntaxNode): SyntaxNode[] | null {
  const args = call.getChild('Args');
  const close = args?.firstChild?.name === 'LeftParen' ? args.getChild('RightParen') : null;
  if (!args || (args.firstChild?.name === 'LeftParen' && !close)) return null;
  const blocks = children(args).filter((node) => !close || node.from >= close.to);
  return blocks.every(isClosedContent) ? blocks : null;
}

/** Whether `call` is `name(..)` alone: closed parentheses, no content block after them. */
export function hasOnlyArguments(call: SyntaxNode): boolean {
  const args = call.getChild('Args');
  return args?.firstChild?.name === 'LeftParen' && args.lastChild?.name === 'RightParen';
}

/** The source range of `node` with the `#` right before it, if it has one (`#table(..)` in markup; not `table(..)` as an argument). */
export function withHash(node: SyntaxNode): { from: number; to: number } {
  const hash = node.prevSibling;
  return { from: hash?.name === 'Hash' && hash.to === node.from ? hash.from : node.from, to: node.to };
}

/** Whether `node` is a content block `[..]` with its closing bracket. */
export function isClosedContent(node: SyntaxNode): boolean {
  return node.name === 'ContentBlock' && node.lastChild?.name === 'RightBracket' && node.getChild('Markup') !== null;
}

/** A Typst string literal's value, if it uses no escapes other than `\"` and `\\`. */
export function decodeString(literal: string): string | null {
  return /^"(?:[^"\\\n]|\\["\\])*"$/.test(literal) ? literal.slice(1, -1).replace(/\\(["\\])/g, '$1') : null;
}

/** A Typst string literal with value `text`. */
export function quote(text: string): string {
  return `"${text.replace(/["\\]/g, '\\$&')}"`;
}

/**
 * Whether `code`, an expression in code (an argument), reads the same after
 * a `#` in markup: one embedded expression, nothing after it, no errors.
 * `ms(18)`, `x.y`, `"text"`, `1pt` and `$x^2$` do; `-1`, `a + b` or a
 * comment do not.
 */
export function isEmbeddable(code: string): boolean {
  if (code.trim() !== code || code === '') return false;
  const markup = `#${code}`;
  const tree = typstParser.parse(markup);
  const hash = tree.topNode.firstChild;
  const expression = hash?.name === 'Hash' ? hash.nextSibling : null;
  const whole = expression?.from === 1 && expression.to === markup.length && !expression.nextSibling;
  if (!whole || /Comment/.test(expression.name)) return false;
  let broken = false;
  tree.iterate({
    enter: (node) => {
      if (node.type.isError || node.name === 'Error') broken = true;
    },
  });
  return !broken;
}

/** The markup that shows what `code` (an embeddable expression) does: `#code`, or an equation as it is. */
export function markupSource(code: string): string {
  return code.startsWith('$') ? code : `#${code}`;
}

/** The main file, then every file it `#include`s, as `neighbours` describes; empty without a main file. */
function readingOrder(read: ReadText, main: ProjectPath): ProjectPath[] {
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

/** Functions whose first positional argument is a file path. */
const CALLS: ReadonlySet<string> = new Set<PathCall>(['image', 'read', 'json', 'csv', 'yaml', 'toml', 'xml', 'cbor', 'bibliography']);

function pathCall(callee: string): PathCall | null {
  return CALLS.has(callee) ? (callee as PathCall) : null;
}

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
  const name = callee?.name === 'Ident' ? pathCall(text.slice(callee.from, callee.to)) : null;
  const first = name ? firstPositional(node.getChild('Args')) : null;
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

/** For an import of the module: null if it brings `name` already, the edit adding it, or undefined if it cannot take it (`as`). */
function extend(text: string, node: SyntaxNode, name: string): TextChange | null | undefined {
  const items = node.getChild('ImportItems');
  if (node.getChild('Star') || (items && imports(text, items, name))) return null;
  if (items) return addItem(items, name);
  const str = node.getChild('Str')!;
  return str.to === node.to ? insert(str.to, `: ${name}`) : undefined;
}

function importsModule(text: string, node: SyntaxNode, request: ImportRequest): boolean {
  const str = node.getChild('Str');
  return str !== null && request.matches(text.slice(str.from + 1, str.to - 1));
}

function imports(text: string, items: SyntaxNode, name: string): boolean {
  return items.getChildren('ImportItemPath').some((item) => text.slice(item.from, item.to) === name);
}

/** Adds `name` after the last item of an import list, which may end with a comma. */
function addItem(items: SyntaxNode, name: string): TextChange {
  const last = items.lastChild!;
  return last.name === 'Comma' ? insert(last.to, ` ${name}`) : insert(last.to, `, ${name}`);
}

function insert(at: number, text: string): TextChange {
  return { from: at, to: at, insert: text };
}
