// ESLint rule `local/entry-imports`: a folder under src/ is entered only through its entry file.
//
// The layout (ARCHITECTURE.md, "Repository layout"):
// - Every folder `x/` has one entry file named like it, `x/x.ts` (a stylesheet may be `x/x.css`).
//   Everything else in the folder is internal: only files inside `x/` may import it.
// - A folder next to a file of the same name (`typst-editor/` beside `typst-editor.ts`) holds that
//   file's internals: only `typst-editor.ts` (and files inside the folder) may import from it.
// - Grouping folders (`core/`, `features/`) have no entry; the rule applies to the folders in them.
// - Only TypeScript and CSS sources count. Generated or data files (wasm/, fonts/, fixtures/) are not
//   modules with an interface.
// - The few exceptions are the rule's `exceptions` option, listed in eslint.config.js.
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

const SOURCE = /\.(ts|css)$/;

/** The file a relative import resolves to, as the bundler would find it (or null). */
function resolveImport(fromFile, specifier) {
  const bare = path.resolve(path.dirname(fromFile), specifier.split('?')[0]);
  for (const candidate of [bare, `${bare}.ts`, path.join(bare, 'index.ts')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Why `importer` may not import `target` (both absolute), or null if it may. */
export function boundaryViolation(importer, target, { srcRoot, groupingFolders = [], exceptions = [] }) {
  const rel = path.relative(srcRoot, target);
  if (rel.startsWith('..') || !SOURCE.test(target)) return null;
  const relImporter = path.relative(path.dirname(srcRoot), importer);
  for (const exception of exceptions) {
    if (rel === exception.target && new RegExp(exception.importers).test(relImporter)) return null;
  }
  const parts = path.dirname(rel).split(path.sep).filter((p) => p !== '.');
  for (let depth = 1; depth <= parts.length; depth++) {
    const folder = path.join(srcRoot, ...parts.slice(0, depth));
    if (depth === 1 && groupingFolders.includes(parts[0])) continue;
    if (importer.startsWith(folder + path.sep)) continue;
    const name = path.basename(folder);
    const owner = `${folder}.ts`;
    if (existsSync(owner)) {
      return importer === owner ? null : `${path.relative(srcRoot, folder)}/ holds the internals of ${path.relative(srcRoot, owner)}; import that file instead`;
    }
    const isEntry = path.dirname(target) === folder && path.basename(target).replace(SOURCE, '') === name;
    return isEntry ? null : `import ${path.relative(srcRoot, folder)}/ through its entry file ${path.relative(srcRoot, folder)}/${name}.ts`;
  }
  return null;
}

export default {
  meta: {
    type: 'problem',
    docs: { description: 'Imports into a folder under src/ go to its entry file only' },
    schema: [
      {
        type: 'object',
        properties: {
          srcRoot: { type: 'string' },
          groupingFolders: { type: 'array', items: { type: 'string' } },
          exceptions: {
            type: 'array',
            items: {
              type: 'object',
              properties: { target: { type: 'string' }, importers: { type: 'string' }, why: { type: 'string' } },
              required: ['target', 'importers', 'why'],
            },
          },
        },
        required: ['srcRoot'],
      },
    ],
    messages: { boundary: "'{{specifier}}': {{reason}} (exceptions: eslint.config.js)." },
  },
  create(context) {
    const options = { ...context.options[0], srcRoot: path.resolve(context.options[0].srcRoot) };
    const importer = path.resolve(context.filename);
    function check(node, source) {
      if (!source || typeof source.value !== 'string' || !source.value.startsWith('.')) return;
      const target = resolveImport(importer, source.value);
      if (!target) return;
      const reason = boundaryViolation(importer, target, options);
      if (reason) context.report({ node: source, messageId: 'boundary', data: { specifier: source.value, reason } });
    }
    return {
      ImportDeclaration: (node) => check(node, node.source),
      ExportNamedDeclaration: (node) => check(node, node.source),
      ExportAllDeclaration: (node) => check(node, node.source),
      ImportExpression: (node) => check(node, node.source.type === 'Literal' ? node.source : null),
    };
  },
};
