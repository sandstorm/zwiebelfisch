// What the import rules share: finding every place a file names another by relative path, and resolving it the way
// the bundler would. Used by:
// - entry-imports.js
// - dependencies.js
// - mise-tasks/quality/module-cycles
//
// Checked: import/export declarations, `import('…')`, `new URL('…', import.meta.url)` (workers, assets) and
// `vi.mock`/`vi.doMock`/`vi.importActual`/`vi.importMock('…')`, each with a literal relative path. Not checked:
// computed paths and `import.meta.glob(…)`.

import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

/** Vitest calls that name a module by path. */
const VI_MODULE_CALLS = new Set(['mock', 'doMock', 'unmock', 'doUnmock', 'importActual', 'importMock']);

/** The file a relative import resolves to, as the bundler would find it (or null). */
export function resolveImport(fromFile, specifier) {
  const bare = path.resolve(path.dirname(fromFile), specifier.split('?')[0]);
  for (const candidate of [bare, `${bare}.ts`, path.join(bare, 'index.ts')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** The string literal argument at `index`, or null. */
function literalArgument(node, index) {
  const argument = node.arguments[index];
  return argument && argument.type === 'Literal' ? argument : null;
}

/** Whether `node` is `import.meta.url`. */
function isImportMetaUrl(node) {
  return node?.type === 'MemberExpression' && node.object.type === 'MetaProperty' && node.property.name === 'url';
}

/**
 * ESLint visitors calling `check(source, target)` for every relative path in the file `importer` that resolves to a
 * file: `source` is the string literal (to report on), `target` the absolute path it names.
 */
export function importVisitors(importer, check) {
  const visit = (source) => {
    if (!source || typeof source.value !== 'string' || !source.value.startsWith('.')) return;
    const target = resolveImport(importer, source.value);
    if (target) check(source, target);
  };
  return {
    ImportDeclaration: (node) => visit(node.source),
    ExportNamedDeclaration: (node) => visit(node.source),
    ExportAllDeclaration: (node) => visit(node.source),
    ImportExpression: (node) => visit(node.source.type === 'Literal' ? node.source : null),
    NewExpression: (node) => {
      if (node.callee.type === 'Identifier' && node.callee.name === 'URL' && isImportMetaUrl(node.arguments[1])) {
        visit(literalArgument(node, 0));
      }
    },
    CallExpression: (node) => {
      const { callee } = node;
      const isViCall = callee.type === 'MemberExpression' && callee.object.type === 'Identifier' && callee.object.name === 'vi';
      if (isViCall && VI_MODULE_CALLS.has(callee.property.name)) visit(literalArgument(node, 0));
    },
  };
}
