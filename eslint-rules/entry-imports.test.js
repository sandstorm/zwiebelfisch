// Tests for the `local/entry-imports` rule, run against the real src/ tree (the rule resolves
// imports on disk). Proves that an import into another folder's internals fails.
import path from 'node:path';
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { boundaries } from '../eslint.config.js';
import entryImports from './entry-imports.js';

const root = path.resolve(import.meta.dirname, '..');

/** The rule's messages for `code` as if it were the file `file` (path from the repository root). */
function lint(file, code) {
  const linter = new Linter({ configType: 'flat', cwd: root });
  const config = [
    {
      files: ['**/*.ts'],
      languageOptions: { parser: tseslint.parser },
      plugins: { local: { rules: { 'entry-imports': entryImports } } },
      rules: { 'local/entry-imports': ['error', boundaries] },
    },
  ];
  return linter.verify(code, config, { filename: path.join(root, file) }).map((m) => m.message);
}

describe('entry-imports', () => {
  it("fails on an import into another folder's internals", () => {
    const messages = lint('src/features/files/files.ts', "import { pageList } from '../preview/pages/page-list';");
    expect(messages).toEqual([expect.stringContaining('through its entry file features/preview/preview.ts')]);
  });

  it("fails on an import into a sibling subfolder's internals", () => {
    const messages = lint('src/features/visual-view/toolbar/toolbar.ts', "import { x } from '../nodes/text-align';");
    expect(messages).toEqual([expect.stringContaining('features/visual-view/nodes/nodes.ts')]);
  });

  it("allows another folder's entry file and anything inside the own folder", () => {
    expect(lint('src/features/files/files.ts', "import { Preview } from '../preview/preview';")).toEqual([]);
    expect(lint('src/features/visual-view/nodes/raw-box.ts', "import { x } from '../projection/projection';")).toEqual([]);
    expect(lint('src/features/visual-view/nodes/raw-box.ts', "import { x } from '../presence';")).toEqual([]);
  });

  it("lets only the owner file into a folder that holds a file's internals", () => {
    expect(lint('src/typst-editor.ts', "import { x } from './typst-editor/editing-views';")).toEqual([]);
    expect(lint('src/index.ts', "import { x } from './typst-editor/editing-views';")).toEqual([
      expect.stringContaining('holds the internals of typst-editor.ts'),
    ]);
  });

  it('allows the listed exceptions, and only for their importers', () => {
    expect(lint('server/src/gitlab/merge.ts', "import { x } from '../../../src/features/collaboration/gitlab-protocol.ts';")).toEqual([]);
    expect(lint('src/typst-editor/collaboration-link.test.ts', "import { x } from '../features/collaboration/in-process';")).toEqual([]);
    expect(lint('src/typst-editor/collaboration-link.ts', "import { x } from '../features/collaboration/in-process';")).toHaveLength(1);
  });

  it('ignores generated and data files', () => {
    expect(lint('src/features/preview/preview.ts', "import url from '../../core/typst-engine/wasm/typst_engine_bg.wasm?url';")).toEqual([]);
  });
});
