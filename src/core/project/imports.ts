// importChange: the edit that makes a name imported from a module in a Typst file, once. See project.ts.
import type { SyntaxNode } from '@lezer/common';
import { typstParser } from 'codemirror-lang-typst/lezer';
import type { TextChange } from '../typst-document/typst-document';

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
 * The edit that makes `name` imported from the module in Typst `text`: null
 * when an import before `use` already brings it (by name or `*`); else the
 * name is added to the item list of the first such import of the module (`: a,
 * b` → `: a, b, name`; a bare `#import "m"` gets `: name`), or `create()` goes
 * at the top. One edit, never a duplicate.
 */
export function importChange(text: string, request: ImportRequest): TextChange | null {
  const use = request.use ?? text.length;
  for (let node = typstParser.parse(text).topNode.firstChild; node; node = node.nextSibling) {
    if (node.to > use) break;
    if (node.name !== 'ModuleImport' || !importsModule(text, node, request)) continue;
    const items = node.getChild('ImportItems');
    if (node.getChild('Star') || (items && imports(text, items, request.name))) return null;
    if (items) return addItem(items, request.name);
    const str = node.getChild('Str')!;
    if (str.to === node.to) return insert(str.to, `: ${request.name}`);
  }
  return insert(0, request.create());
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
