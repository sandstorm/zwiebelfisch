// Code-quality gate. Thresholds here are the single source of truth
// (see .claude/skills/code-quality/SKILL.md). Formatting is not linted.
import { fileURLToPath } from 'node:url';
import tseslint from 'typescript-eslint';
import sonarjs from 'eslint-plugin-sonarjs';
import entryImports from './eslint-rules/entry-imports.js';

export const thresholds = {
  cognitive: 12,
  cyclomatic: 10,
  depth: 3,
  linesPerFunction: 60,
  params: 4,
};

// The folder boundaries and their only exceptions. `importers` is a regular expression over the
// importing file's path from the repository root.
export const boundaries = {
  srcRoot: fileURLToPath(new URL('src', import.meta.url)),
  groupingFolders: ['core', 'features', 'hosts'],
  exceptions: [
    {
      target: 'features/collaboration/gitlab-protocol.ts',
      importers: '.',
      why: 'import-free room protocol shared with the server and with features/versions (which must not load the lazily loaded collaboration chunk)',
    },
    {
      target: 'core/typst-engine/engine-assets.ts',
      importers: '^src/hosts/preview/preview\\.ts$',
      why: 'asset URLs (wasm, default fonts) for the main thread; in the entry, the worker bundle would emit every asset again',
    },
    {
      target: 'features/collaboration/in-process.ts',
      importers: '\\.test\\.ts$',
      why: 'tests wire Y.Docs and awarenesses together in-process',
    },
    {
      target: 'features/collaboration/shared-project.ts',
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
    // Folder boundaries under src/: imports into a folder go to its entry file (see eslint-rules/entry-imports.js).
    files: ['**/*.ts'],
    plugins: { local: { rules: { 'entry-imports': entryImports } } },
    rules: { 'local/entry-imports': ['error', boundaries] },
  },
  {
    // test bodies are long by nature; complexity limits still apply
    files: ['**/*.test.ts', 'tests/**/*.ts'],
    rules: { 'max-lines-per-function': 'off' },
  },
);
