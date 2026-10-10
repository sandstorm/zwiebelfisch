// Code-quality gate. Thresholds here are the single source of truth
// (see .claude/skills/code-quality/SKILL.md). Formatting is not linted.
import { fileURLToPath } from 'node:url';
import tseslint from 'typescript-eslint';
import sonarjs from 'eslint-plugin-sonarjs';
import entryImports from './eslint-rules/entry-imports.js';
import noReExports from './eslint-rules/no-re-exports.js';

/** DOM globals core/ must not use, as values (no-restricted-globals) or types (no-restricted-types). */
const DOM_GLOBALS = [
  'window', 'document', 'navigator', 'location', 'history', 'localStorage', 'sessionStorage', 'requestAnimationFrame',
  'cancelAnimationFrame', 'getComputedStyle', 'matchMedia', 'customElements', 'Node', 'Element', 'HTMLElement',
  'SVGElement', 'Document', 'DocumentFragment', 'ShadowRoot', 'MutationObserver', 'ResizeObserver', 'IntersectionObserver',
  'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'DragEvent', 'DataTransfer', 'File', 'FileList', 'FileReader',
];
const NO_DOM = 'core/ uses no DOM (it runs in the engine worker and on the server too).';

export const thresholds = {
  cognitive: 12,
  cyclomatic: 10,
  depth: 3,
  linesPerFunction: 60,
  params: 4,
};

// Files that may re-export (`export … from`, or export an imported name), each with its reason. Everywhere else a
// module's entry defines its API and internal files are not forwarded (eslint-rules/no-re-exports.js); the list
// should shrink, not grow.
export const reExportExceptions = [
  { files: 'src/index.ts', why: 'the package entry: the public API is gathered from the modules that define it' },
];

// The folder boundaries and their only exceptions. `importers` is a regular expression over the
// importing file's path from the repository root.
export const boundaries = {
  srcRoot: fileURLToPath(new URL('src', import.meta.url)),
  groupingFolders: ['core', 'extensions', 'hosts', 'ui'],
  exceptions: [
    {
      target: 'core/typst-engine/engine-assets.ts',
      importers: '^src/hosts/preview/preview\\.ts$',
      why: 'asset URLs (wasm, default fonts) for the main thread; in the entry, the worker bundle would emit every asset again',
    },
    {
      target: 'extensions/collaboration/model/in-process.ts',
      importers: '\\.test\\.ts$',
      why: 'tests wire Y.Docs and awarenesses together in-process',
    },
    {
      target: 'extensions/collaboration/model/shared-project.ts',
      importers: '^server/.*\\.test\\.ts$',
      why: "the server's tests build rooms from the client's SharedProject",
    },
  ],
};

export default tseslint.config(
  { ignores: ['dist/**', '.cache/**', '.claude/**', 'node_modules/**', 'test-results/**', 'playwright-report/**'] },
  {
    files: ['**/*.ts'],
    languageOptions: { parser: tseslint.parser },
    plugins: { sonarjs },
    rules: {
      'sonarjs/cognitive-complexity': ['error', thresholds.cognitive],
      complexity: ['error', thresholds.cyclomatic],
      'max-depth': ['error', thresholds.depth],
      'max-lines-per-function': ['error', { max: thresholds.linesPerFunction, skipBlankLines: true, skipComments: true }],
      'max-params': ['error', thresholds.params],
    },
  },
  {
    // Module boundaries under src/: imports into a module go to its entry file (eslint-rules/entry-imports.js); no
    // re-exports (eslint-rules/no-re-exports.js).
    files: ['**/*.ts'],
    plugins: { local: { rules: { 'entry-imports': entryImports, 'no-re-exports': noReExports } } },
    rules: { 'local/entry-imports': ['error', boundaries], 'local/no-re-exports': 'error' },
  },
  {
    // a file exports only what it defines; the exceptions above
    files: reExportExceptions.map((exception) => exception.files),
    rules: { 'local/no-re-exports': 'off' },
  },
  {
    // Layers (docs/2026_10_10_extensions-architecture.md, "Dependency rules"): src/testing/ composes the built-in
    // extensions for tests, so only tests may import it.
    files: ['src/**/*.ts'],
    ignores: ['**/*.test.ts', 'src/testing/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: [{ group: ['**/testing/testing'], message: 'src/testing/ is for tests (*.test.ts) only.' }] }] },
  },
  {
    // Hosts offer contribution points and know no extension, also not in their tests (which use the host's own nodes
    // and specs of their own; tests of the built-ins together are the widget's, in typst-editor/).
    files: ['src/hosts/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['**/extensions/**', '**/testing/testing', '**/typst-editor/**'], message: 'hosts never import extensions/, testing/ or typst-editor/.' }] },
      ],
    },
  },
  {
    // core/ is the models everything builds on: no collaboration library (the collaboration extension binds a Y.Text
    // to a TypstDocument from outside), no view, host or extension.
    files: ['src/core/**/*.ts'],
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['yjs', 'y-*', '@hocuspocus/*'], message: 'core/ knows no Yjs: the collaboration extension binds documents from outside.' },
            { group: ['**/hosts/**', '**/extensions/**', '**/ui/**', '**/testing/testing', '**/typst-editor/**'], message: 'core/ imports only core/.' },
          ],
        },
      ],
      // no DOM: core runs in the engine worker and the server's tests as well (fetch, Blob and streams are fine)
      'no-restricted-globals': ['error', ...DOM_GLOBALS.map((name) => ({ name, message: NO_DOM }))],
      '@typescript-eslint/no-restricted-types': ['error', { types: Object.fromEntries(DOM_GLOBALS.map((name) => [name, NO_DOM])) }],
    },
  },
  {
    // test bodies are long by nature; complexity limits still apply
    files: ['**/*.test.ts', 'tests/**/*.ts'],
    rules: { 'max-lines-per-function': 'off' },
  },
);
