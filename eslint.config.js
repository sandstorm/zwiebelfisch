// Code-quality gate. Thresholds here are the single source of truth
// (see .claude/skills/code-quality/SKILL.md). Formatting is not linted.
import { fileURLToPath } from 'node:url';
import tseslint from 'typescript-eslint';
import sonarjs from 'eslint-plugin-sonarjs';
import dependencies from './eslint-rules/dependencies.js';
import entryImports from './eslint-rules/entry-imports.js';
import noReExports from './eslint-rules/no-re-exports.js';

/** DOM globals core/ and model/ folders must not use, as values (no-restricted-globals) or types (no-restricted-types). */
const DOM_GLOBALS = [
  'window', 'document', 'navigator', 'location', 'history', 'localStorage', 'sessionStorage', 'requestAnimationFrame',
  'cancelAnimationFrame', 'getComputedStyle', 'matchMedia', 'customElements', 'Node', 'Element', 'HTMLElement',
  'SVGElement', 'Document', 'DocumentFragment', 'ShadowRoot', 'MutationObserver', 'ResizeObserver', 'IntersectionObserver',
  'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'DragEvent', 'DataTransfer', 'File', 'FileList', 'FileReader',
];
const NO_DOM = {
  core: 'core/ uses no DOM (it runs in the engine worker and on the server too).',
  model: 'model/ is pure: no DOM (the view folders next to it draw).',
};

/** Editor libraries: views. core/ and model/ folders import none. */
const EDITOR_LIBRARIES = {
  paths: ['codemirror'],
  patterns: ['@tiptap/*', 'prosemirror-*', '@codemirror/*'],
};

/** `no-restricted-globals` and `no-restricted-types` for the DOM, with `message`. */
function noDom(message) {
  return {
    'no-restricted-globals': ['error', ...DOM_GLOBALS.map((name) => ({ name, message }))],
    '@typescript-eslint/no-restricted-types': ['error', { types: Object.fromEntries(DOM_GLOBALS.map((name) => [name, message])) }],
  };
}

// The layers (docs/30_architecture/10_conventions.typ, "Layers"), on resolved files
// (eslint-rules/dependencies.js): `importers` may not import `forbidden` (regular expressions over paths from the
// repository root; `$1` is what `importers` captured). Tests included, unless a rule says otherwise.
export const layers = [
  { importers: '^src/core/', forbidden: '^src/(?!core/)', message: 'core/ imports only core/.' },
  {
    importers: '^src/ui/([^/]+)/',
    forbidden: '^src/(?!core/|ui/$1/)',
    message: 'ui/ imports only core/: a feature-neutral widget knows no host, extension or other widget.',
  },
  {
    importers: '^src/hosts/',
    forbidden: '^src/(extensions|typst-editor|typst-editor-element|testing)/',
    message: "hosts never import extensions/, testing/ or typst-editor/ (a host's tests use its own nodes and specs).",
  },
  {
    importers: '^src/extensions/([^/]+)/',
    forbidden: '^src/extensions/(?!$1/)',
    message: 'extensions never import each other: they meet through core models or a generic host contribution point.',
  },
  {
    importers: '^src/extensions/([^/]+)/model/',
    forbidden: '^src/extensions/$1/(visual-view|source-view|preview|workbench)/',
    message: 'model/ imports no view folder of its extension (the views import the model, not the other way).',
  },
  {
    importers: '^src/extensions/[^/]+/model/',
    forbidden: '^src/(hosts|ui|typst-editor|typst-editor-element)/',
    message: "model/ builds on core/ only: hosts and ui/ are views (the extension's view folders use them).",
  },
  {
    importers: '^(?!src/testing/)(?!.*\\.test\\.ts$)',
    forbidden: '^src/testing/',
    message: 'src/testing/ composes the built-in extensions for tests: only *.test.ts files import it.',
  },
];

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
      target: 'extensions/collaboration/model/shared-project.ts',
      importers: '^server/.*\\.test\\.ts$',
      why: "the server's tests build rooms from the client's SharedProject",
    },
    {
      target: 'extensions/collaboration/model/in-process.ts',
      importers: '^server/.*\\.test\\.ts$',
      why: "the server's tests wire those rooms' Y.Docs together in-process",
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
    plugins: { local: { rules: { 'entry-imports': entryImports, 'no-re-exports': noReExports, dependencies } } },
    rules: { 'local/entry-imports': ['error', boundaries], 'local/no-re-exports': 'error' },
  },
  {
    // a file exports only what it defines; the exceptions above
    files: reExportExceptions.map((exception) => exception.files),
    rules: { 'local/no-re-exports': 'off' },
  },
  {
    // Layers: which folders may import which (the list `layers` above).
    files: ['**/*.ts'],
    rules: { 'local/dependencies': ['error', { rules: layers }] },
  },
  {
    // core/ is the models everything builds on: no collaboration library (the collaboration extension binds a Y.Text
    // to a TypstDocument from outside), no editor library, no DOM (fetch, Blob and streams are fine: workers have them).
    files: ['src/core/**/*.ts'],
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: EDITOR_LIBRARIES.paths.map((name) => ({ name, message: 'core/ imports no editor library.' })),
          patterns: [
            { group: ['yjs', 'y-*', '@hocuspocus/*'], message: 'core/ knows no Yjs: the collaboration extension binds documents from outside.' },
            { group: EDITOR_LIBRARIES.patterns, message: 'core/ imports no editor library.' },
          ],
        },
      ],
      ...noDom(NO_DOM.core),
    },
  },
  {
    // An extension's model/ is pure: read models, parsing, `calculate…` commands; no editor library, no DOM.
    files: ['src/**/model/**/*.ts'],
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: EDITOR_LIBRARIES.paths.map((name) => ({ name, message: 'model/ imports no editor library.' })),
          patterns: [{ group: EDITOR_LIBRARIES.patterns, message: 'model/ imports no editor library.' }],
        },
      ],
      ...noDom(NO_DOM.model),
    },
  },
  {
    // test bodies are long by nature; complexity limits still apply
    files: ['**/*.test.ts', 'tests/**/*.ts'],
    rules: { 'max-lines-per-function': 'off' },
  },
);
