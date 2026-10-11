// What copied Typst needs imported, and the imports pasted Typst gets. See imports in ../imports.ts.
import { typstParser } from 'codemirror-lang-typst/lezer';
import { PathReference, ProjectPath } from '../../../core/paths/paths';
import { SourceOffset, type TextChange } from '../../../core/typst-document/typst-document';
import { calculateImportChange, importedNames, quote } from '../../../core/typst-syntax/typst-syntax';

/** An import copied Typst needs: the module (a project file's path, or a package as written) and the item as written (`a as b`). */
export interface CopiedImport {
  readonly module: string;
  readonly item: string;
}

/** The clipboard type of the copied imports (JSON, a `CopiedImport[]`). */
export const IMPORTS_TYPE = 'application/x-typst-imports';

/**
 * The imports of Typst `text` (the file `file`) that `copied`, a part of it, uses: each item whose bound name the
 * copied text names, its module a project path (resolved from `file`) or a package. Star imports are left out (which
 * of their names the text uses is unknown).
 */
export function copiedImports(text: string, file: ProjectPath, copied: string): CopiedImport[] {
  const used = namesUsed(copied);
  return importedNames(text).flatMap(({ module, name, binding }) => {
    const resolved = module.startsWith('@') ? module : ProjectPath.resolve(file, PathReference.of(module));
    if (name === '*' || !used.has(binding) || resolved === null) return [];
    return [{ module: resolved, item: name === binding ? name : `${name} as ${binding}` }];
  });
}

/** The copied imports on a clipboard (`IMPORTS_TYPE`); none if there are none or they are no such list. */
export function parseCopiedImports(json: string): CopiedImport[] {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter(isCopiedImport) : [];
  } catch {
    return [];
  }
}

/**
 * The changes, each applying to the text after the ones before it, that import into the Typst file `file` (its text
 * `after` the paste; `before` it) the names the paste newly uses and the file does not define or import yet: from
 * `copied` (the source file's imports), else from `known` (what extensions declare). A name is added to an import of
 * its module (a file that resolves to the same path, a package of any version), else a new import goes at the top.
 * Never a duplicate.
 */
export function calculatePastedImports(
  { file, before, after }: { file: ProjectPath; before: string; after: string },
  copied: readonly CopiedImport[],
  known: readonly { name: string; module: string }[],
): TextChange[] {
  const old = namesUsed(before);
  const bound = namesBound(after);
  const sources = [...copied, ...known.map(({ name, module }) => ({ module, item: name }))];
  const wanted = [...namesUsed(after)].flatMap((name) => {
    const found = old.has(name) || bound.has(name) ? undefined : sources.find((source) => bindingOf(source.item) === name);
    return found ? [found] : [];
  });
  const changes: TextChange[] = [];
  let text = after;
  for (const { module, item } of wanted) {
    const change = importChange(text, file, module, item);
    if (!change) continue;
    changes.push(change);
    text = text.slice(0, change.from) + change.insert + text.slice(change.to);
  }
  return changes;
}

/** The change importing `item` from `module` into Typst `text` (the file `file`), or null if it is imported already. */
function importChange(text: string, file: ProjectPath, module: string, item: string): TextChange | null {
  const isPackage = module.startsWith('@');
  const written = isPackage ? module : ProjectPath.referenceTo(file, module as ProjectPath);
  const matches = isPackage
    ? (other: string) => other.startsWith(module.slice(0, module.lastIndexOf(':') + 1))
    : (other: string) => ProjectPath.resolve(file, PathReference.of(other)) === module;
  // a blank line after a new import, unless more imports follow: an import right above a block would make the two one (raw) block
  const create = () => `#import ${quote(written)}: ${item}\n${/^\s*(\n|#import\b)/.test(text) ? '' : '\n'}`;
  return calculateImportChange(text, { name: item, matches, create, use: SourceOffset.of(text.length) });
}

/** The names Typst `text` uses in code and math: identifiers, not the fields after a dot nor argument names. */
function namesUsed(text: string): Set<string> {
  const names = new Set<string>();
  typstParser.parse(text).iterate({
    enter: (node) => {
      const parent = node.node.parent;
      const field = parent?.name === 'FieldAccess' && node.node.prevSibling?.name === 'Dot';
      const argumentName = parent?.name === 'Named' && node.node.prevSibling === null;
      if ((node.name === 'Ident' || node.name === 'MathIdent') && !field && !argumentName) names.add(text.slice(node.from, node.to));
    },
  });
  return names;
}

/** The names Typst `text` binds at its top level: imported (by name) and defined with `#let`. */
function namesBound(text: string): Set<string> {
  const names = new Set(importedNames(text).map((imported) => imported.binding));
  for (let node = typstParser.parse(text).topNode.firstChild; node; node = node.nextSibling) {
    if (node.name !== 'LetBinding') continue;
    const name = node.getChild('Ident') ?? node.getChild('Closure')?.getChild('Ident');
    if (name) names.add(text.slice(name.from, name.to));
  }
  return names;
}

/** The name an import item binds: `b` of `a as b`. */
function bindingOf(item: string): string {
  return item.split(' as ').at(-1)!;
}

/** Whether `value` is a copied import: a package or a project path, and an item that is a name or `name as name`. */
function isCopiedImport(value: unknown): value is CopiedImport {
  if (typeof value !== 'object' || value === null) return false;
  const { module, item } = value as Record<string, unknown>;
  return typeof item === 'string' && ITEM.test(item) && typeof module === 'string' && (module.startsWith('@') || ProjectPath.parse(module) !== null);
}

const ITEM = /^[\p{L}_][\p{L}\p{N}_-]*(?: as [\p{L}_][\p{L}\p{N}_-]*)?$/u;
