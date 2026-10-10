// provideDocumentLinks: the file paths a Typst text names (imports, includes, image/read/data calls), found in its Lezer
// syntax tree. See document-links.ts.
import type { SyntaxNode, Tree } from '@lezer/common';
import { typstParser } from 'codemirror-lang-typst/lezer';
import { PathReference } from '../paths/paths';

/** What names the path: `#import`, `#include`, or the function whose first argument it is. */
export type LinkCall = 'import' | 'include' | 'image' | 'read' | 'json' | 'csv' | 'yaml' | 'toml' | 'xml' | 'cbor' | 'bibliography';

/** A file path written in Typst source, as written (relative to that file, or `/` from the project root). */
export interface DocumentLink {
  /** The path as Typst reads it (escapes decoded). */
  path: PathReference;
  /** The range of the path's text (inside the quotes). */
  from: number;
  to: number;
  call: LinkCall;
}

/** Functions whose first positional argument is a file path. */
const CALLS = new Set<LinkCall>(['image', 'read', 'json', 'csv', 'yaml', 'toml', 'xml', 'cbor', 'bibliography']);

/** The file paths `text` names (see `DocumentLinkProvider.provideDocumentLinks`). */
export function provideDocumentLinks(text: string, options: { tree?: Tree; from?: number; to?: number } = {}): DocumentLink[] {
  const tree = options.tree ?? typstParser.parse(text);
  const found: DocumentLink[] = [];
  tree.iterate({
    from: options.from,
    to: options.to,
    enter: (node) => {
      for (const link of linksOf(node.node, text)) found.push(link);
    },
  });
  return found;
}

/** The link whose string (quotes included) holds `offset`, or null. */
export function documentLinkAt(text: string, offset: number, tree?: Tree): DocumentLink | null {
  const candidates = provideDocumentLinks(text, { tree, from: Math.max(0, offset - 1), to: offset + 1 });
  return candidates.find((r) => r.from - 1 <= offset && offset <= r.to + 1) ?? null;
}

function linksOf(node: SyntaxNode, text: string): DocumentLink[] {
  if (node.name === 'ModuleImport' || node.name === 'ModuleInclude') return importLinks(node, text);
  return node.name === 'FuncCall' ? callLinks(node, text) : [];
}

/** `import "…"` / `include "…"`. */
function importLinks(node: SyntaxNode, text: string): DocumentLink[] {
  const string = node.getChild('Str');
  return string ? onlyFiles([link(string, text, node.name === 'ModuleImport' ? 'import' : 'include')]) : [];
}

/** `image("…")`, `bibliography(("…", "…"))`, …: the first positional argument. */
function callLinks(node: SyntaxNode, text: string): DocumentLink[] {
  const callee = node.firstChild;
  const name = callee?.name === 'Ident' ? (text.slice(callee.from, callee.to) as LinkCall) : null;
  const first = name && CALLS.has(name) ? firstPositional(node.getChild('Args')) : null;
  if (!name || !first) return [];
  const strings = first.name === 'Array' && name === 'bibliography' ? first.getChildren('Str') : first.name === 'Str' ? [first] : [];
  return onlyFiles(strings.map((string) => link(string, text, name)));
}

const SYNTAX = new Set(['LeftParen', 'RightParen', 'Comma', 'Space', 'LineComment', 'BlockComment']);

function firstPositional(args: SyntaxNode | null): SyntaxNode | null {
  for (let child = args?.firstChild ?? null; child; child = child.nextSibling) {
    if (!SYNTAX.has(child.name)) return child.name === 'Named' || child.name === 'Spread' ? null : child;
  }
  return null;
}

function link(string: SyntaxNode, text: string, call: LinkCall): DocumentLink {
  const from = string.from + 1;
  const to = Math.max(from, text[string.to - 1] === '"' && string.to - 1 > string.from ? string.to - 1 : string.to);
  return { path: PathReference.of(unescape(text.slice(from, to))), from, to, call };
}

/** Not packages, not empty. */
function onlyFiles(links: DocumentLink[]): DocumentLink[] {
  return links.filter((link) => link.path !== '' && !link.path.startsWith('@'));
}

const ESCAPES: Record<string, string> = { n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\' };

function unescape(raw: string): string {
  return raw.replace(/\\(u\{([0-9a-fA-F]+)\}|.)/g, (all, escape: string, hex?: string) =>
    hex ? String.fromCodePoint(parseInt(hex, 16)) : (ESCAPES[escape] ?? all),
  );
}
