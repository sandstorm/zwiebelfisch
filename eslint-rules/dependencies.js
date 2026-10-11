// ESLint rule `local/dependencies`: which folders may import which (docs/architecture/conventions.typ,
// "Layers").
//
// Works on resolved files, not on import strings, so a relative path cannot slip past it (`../labels/labels` from
// another extension). Each entry of the `rules` option forbids files matching `importers` to import files matching
// `forbidden`; both are regular expressions over paths from the repository root, and `$1`, `$2`, … in `forbidden`
// stand for the groups `importers` captured (an extension's own name). The rules are listed in eslint.config.js.
// Which paths are checked: see imports.js.
import path from 'node:path';
import { importVisitors } from './imports.js';

/** Escapes `text` for use inside a regular expression. */
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The message of the first rule `importer` breaks by importing `target` (paths from the repository root), or null. */
export function dependencyViolation(importer, target, rules) {
  for (const rule of rules) {
    const match = new RegExp(rule.importers).exec(importer);
    if (!match) continue;
    const forbidden = rule.forbidden.replace(/\$(\d)/g, (_, index) => escape(match[Number(index)] ?? ''));
    if (new RegExp(forbidden).test(target)) return rule.message;
  }
  return null;
}

export default {
  meta: {
    type: 'problem',
    docs: { description: 'Folders import only what the layer rules allow' },
    schema: [
      {
        type: 'object',
        properties: {
          rules: {
            type: 'array',
            items: {
              type: 'object',
              properties: { importers: { type: 'string' }, forbidden: { type: 'string' }, message: { type: 'string' } },
              required: ['importers', 'forbidden', 'message'],
            },
          },
        },
        required: ['rules'],
      },
    ],
    messages: { layer: "'{{specifier}}': {{message}}" },
  },
  create(context) {
    const { rules } = context.options[0];
    const importer = path.resolve(context.filename);
    const fromRoot = (file) => path.relative(context.cwd, file).split(path.sep).join('/');
    return importVisitors(importer, (source, target) => {
      const message = dependencyViolation(fromRoot(importer), fromRoot(target), rules);
      if (message) context.report({ node: source, messageId: 'layer', data: { specifier: source.value, message } });
    });
  },
};
