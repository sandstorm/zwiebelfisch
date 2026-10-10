// ESLint rule `local/entry-imports`: a module under src/ is entered only through its entry file.
//
// The layout (ARCHITECTURE.md, "Folder rules"):
// - The modules are the folders `core/<name>/`, `hosts/<name>/`, `extensions/<name>/`, `ui/<name>/` and the
//   top-level folders `typst-editor/`, `typst-editor-element/`, `testing/`. `core/`, `hosts/`, `extensions/` and
//   `ui/` only group modules.
// - A module's entry file is named like it, `x/x.ts` (a stylesheet may be `x/x.css`), and lives inside it. From
//   outside the module only the entry may be imported.
// - Inside a module everything is open: layer and concept subfolders (`model/`, `visual-view/`, `projection/`, …)
//   have no entry files of their own, and files import each other directly.
// - Only TypeScript and CSS sources count. Generated or data files (wasm/, fonts/, fixtures/) are not
//   modules with an interface.
// - The few exceptions are the rule's `exceptions` option, listed in eslint.config.js.
//
// Checked: import/export declarations, `import('…')`, `new URL('…', import.meta.url)` (workers,
// assets) and `vi.mock`/`vi.doMock`/`vi.importActual`/`vi.importMock('…')`, each with a literal
// relative path. Not checked: computed paths and `import.meta.glob(…)`.
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

const SOURCE = /\.(ts|css)$/;

/** Vitest calls that name a module by path. */
const VI_MODULE_CALLS = new Set(['mock', 'doMock', 'unmock', 'doUnmock', 'importActual', 'importMock']);

/** The string literal argument at `index`, or null. */
function literalArgument(node, index) {
  const argument = node.arguments[index];
  return argument && argument.type === 'Literal' ? argument : null;
}

/** Whether `node` is `import.meta.url`. */
function isImportMetaUrl(node) {
  return node?.type === 'MemberExpression' && node.object.type === 'MetaProperty' && node.property.name === 'url';
}

/** The file a relative import resolves to, as the bundler would find it (or null). */
function resolveImport(fromFile, specifier) {
  const bare = path.resolve(path.dirname(fromFile), specifier.split('?')[0]);
  for (const candidate of [bare, `${bare}.ts`, path.join(bare, 'index.ts')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** The module folder (absolute) `file` belongs to, or null for files directly in src/ or outside it. */
export function moduleOf(file, { srcRoot, groupingFolders = [] }) {
  const parts = path.relative(srcRoot, file).split(path.sep);
  if (parts[0] === '..' || parts.length < 2) return null;
  const depth = groupingFolders.includes(parts[0]) ? 2 : 1;
  return parts.length > depth ? path.join(srcRoot, ...parts.slice(0, depth)) : null;
}

/** Why `importer` may not import `target` (both absolute), or null if it may. */
export function boundaryViolation(importer, target, options) {
  const { srcRoot, exceptions = [] } = options;
  const module = moduleOf(target, options);
  if (!module || !SOURCE.test(target) || importer.startsWith(module + path.sep)) return null;
  const name = path.basename(module);
  if (path.dirname(target) === module && path.basename(target).replace(SOURCE, '') === name) return null;
  const relImporter = path.relative(path.dirname(srcRoot), importer);
  const rel = path.relative(srcRoot, target);
  if (exceptions.some((exception) => rel === exception.target && new RegExp(exception.importers).test(relImporter))) return null;
  const folder = path.relative(srcRoot, module);
  return `import ${folder}/ through its entry file ${folder}/${name}.ts`;
}

export default {
  meta: {
    type: 'problem',
    docs: { description: 'Imports into a module under src/ go to its entry file only' },
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
      NewExpression: (node) => {
        if (node.callee.type === 'Identifier' && node.callee.name === 'URL' && isImportMetaUrl(node.arguments[1])) {
          check(node, literalArgument(node, 0));
        }
      },
      CallExpression: (node) => {
        const { callee } = node;
        const isViCall = callee.type === 'MemberExpression' && callee.object.type === 'Identifier' && callee.object.name === 'vi';
        if (isViCall && VI_MODULE_CALLS.has(callee.property.name)) check(node, literalArgument(node, 0));
      },
    };
  },
};
