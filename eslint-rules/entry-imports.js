// ESLint rule `local/entry-imports`: a module under src/ is entered only through its entry file.
//
// The layout (docs/40_architecture/14_conventions.typ):
// - The modules are the folders `core/<name>/`, `hosts/<name>/`, `extensions/<name>/` and the top-level folders
//   `typst-editor/`, `typst-editor-element/`, `testing/`. `core/`, `hosts/` and `extensions/` only group modules.
// - A module's entry file is named like it, `x/x.ts` (a stylesheet may be `x/x.css`), and lives inside it. From
//   outside the module only the entry may be imported.
// - Inside a module everything is open: layer and concept subfolders (`model/`, `visual-editor/`, `nodes/`, …)
//   have no entry files of their own, and files import each other directly.
// - Only TypeScript and CSS sources count. Generated or data files (wasm/, fonts/, fixtures/) are not
//   modules with an interface.
// - The few exceptions are the rule's `exceptions` option, listed in eslint.config.js.
//
// Which paths are checked: see imports.js.
import path from 'node:path';
import { importVisitors } from './imports.js';

const SOURCE = /\.(ts|css)$/;

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
    return importVisitors(path.resolve(context.filename), (source, target) => {
      const reason = boundaryViolation(path.resolve(context.filename), target, options);
      if (reason) context.report({ node: source, messageId: 'boundary', data: { specifier: source.value, reason } });
    });
  },
};
