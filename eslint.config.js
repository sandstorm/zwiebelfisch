// Code-quality gate. Thresholds here are the single source of truth
// (see .claude/skills/code-quality/SKILL.md). Formatting is not linted.
import tseslint from 'typescript-eslint';
import sonarjs from 'eslint-plugin-sonarjs';

export const thresholds = {
  cognitive: 12,
  cyclomatic: 10,
  depth: 3,
  linesPerFunction: 60,
  params: 4,
};

export default tseslint.config(
  { ignores: ['dist/**', '.cache/**', 'node_modules/**', 'test-results/**', 'playwright-report/**'] },
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
    // test bodies are long by nature; complexity limits still apply
    files: ['**/*.test.ts', 'tests/**/*.ts'],
    rules: { 'max-lines-per-function': 'off' },
  },
);
