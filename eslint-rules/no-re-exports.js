// ESLint rule `local/no-re-exports`: a file exports only what it defines.
//
// Flagged: `export * from`, `export { x } from` (also `export type`), and `export { x }` / `export default x` of an
// imported name.

/** Whether the module-scope name `name` is bound by an import declaration. */
function isImported(scope, name) {
  const variable = scope.set.get(name);
  return variable !== undefined && variable.defs.some((def) => def.type === 'ImportBinding');
}

/** The module scope (or the global scope when the parser reports none). */
function moduleScope(sourceCode, node) {
  const scope = sourceCode.getScope(node);
  return scope.childScopes.find((child) => child.type === 'module') ?? scope;
}

/** The rule `local/no-re-exports`. The package entry (src/index.ts) is left out of it, as it is the one file that re-exports. */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'A file exports only what it defines (no re-exports outside the package entry)' },
    schema: [],
    messages: {
      reExport:
        "'{{name}}' is re-exported: export only what this file defines. Move the code into the module that owns the API, or import it where it is used (exceptions: eslint.config.js).",
    },
  },
  create(context) {
    const report = (node, name) => context.report({ node, messageId: 'reExport', data: { name } });
    let scope;
    return {
      Program: (node) => {
        scope = moduleScope(context.sourceCode, node);
      },
      ExportAllDeclaration: (node) => report(node, node.exported ? node.exported.name : `* from ${node.source.value}`),
      ExportNamedDeclaration: (node) => {
        if (node.declaration) return;
        for (const specifier of node.specifiers) {
          if (node.source || isImported(scope, specifier.local.name)) report(specifier, specifier.local.name ?? specifier.local.value);
        }
      },
      ExportDefaultDeclaration: (node) => {
        if (node.declaration.type === 'Identifier' && isImported(scope, node.declaration.name)) report(node, node.declaration.name);
      },
    };
  },
};
