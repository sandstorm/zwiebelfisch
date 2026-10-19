// ESLint rule `local/entry-imports`: a module under src/ is entered only through its entry file.
//
// - A module is a folder directly under src/, or one level deeper in a grouping folder (the `groupingFolders`
//   option: `core/`, `hosts/`, `extensions/`).
// - Its entry file is named like it, `x/x.ts` (a stylesheet may be `x/x.css`). From outside the module only the entry
//   may be imported; inside it everything is open.
// - Only TypeScript and CSS files count.
// - The exceptions are the `exceptions` option.
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
