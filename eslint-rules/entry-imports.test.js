// Tests for the `local/entry-imports` rule, run against the real src/ tree (the rule resolves
// imports on disk). Proves that an import into another module's internals fails, and that a module's own
// subfolders are open to it.
import path from 'node:path';
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { boundaries } from '../eslint.config.js';
import entryImports from './entry-imports.js';

const root = path.resolve(import.meta.dirname, '..');

/** The rule's messages for `code` as if it were the file `file` (path from the repository root), with eslint.config.js's options. */
function lint(file, code, options = boundaries) {
  const linter = new Linter({ configType: 'flat', cwd: root });
  const config = [
    {
      files: ['**/*.ts'],
      languageOptions: { parser: tseslint.parser },
      plugins: { local: { rules: { 'entry-imports': entryImports } } },
      rules: { 'local/entry-imports': ['error', options] },
    },
  ];
  return linter.verify(code, config, { filename: path.join(root, file) }).map((m) => m.message);
}

describe('entry-imports', () => {
  it("fails on an import into another folder's internals", () => {
    const messages = lint('src/extensions/files/files.ts', "import { pageList } from '../../hosts/preview/pages/page-list';");
    expect(messages).toEqual([expect.stringContaining('through its entry file hosts/preview/preview.ts')]);
  });

  it('opens a module to its own files, subfolders included: they have no entries of their own', () => {
    expect(lint('src/hosts/visual-editor/toolbar/toolbar.ts', "import { x } from '../nodes/raw-box';")).toEqual([]);
    expect(lint('src/extensions/labels/labels.ts', "import { x } from './model/label-index';")).toEqual([]);
    expect(lint('src/extensions/labels/visual-editor/reference-node.ts', "import { x } from '../model/label-index';")).toEqual([]);
  });

  it("fails on an import of another module's subfolder file, also from a module in the same group", () => {
    expect(lint('src/extensions/styles/styles.ts', "import { x } from '../labels/model/label-index';")).toEqual([
      expect.stringContaining('through its entry file extensions/labels/labels.ts'),
    ]);
    expect(lint('src/editor/editor.ts', "import { x } from '../testing/testing';")).toEqual([]);
    expect(lint('src/editor/editor.ts', "import { x } from '../editor-element/editor-element';")).toEqual([]);
  });

  it('enters a host through its entry file only (hosts/ only groups)', () => {
    expect(lint('src/editor/editor.ts', "import { x } from '../hosts/workbench/workbench';")).toEqual([]);
    expect(lint('src/editor/editor.ts', "import { x } from '../hosts/workbench/layout/workbench-layout';")).toEqual([
      expect.stringContaining('through its entry file hosts/workbench/workbench.ts'),
    ]);
  });

  it('allows the listed exceptions, and only for their importers', () => {
    const options = {
      ...boundaries,
      exceptions: [{ target: 'extensions/collaboration/model/in-process.ts', importers: '^tests/.*\\.test\\.ts$', why: 'a test' }],
    };
    const inProcess = "import { x } from '../../src/extensions/collaboration/model/in-process';";
    expect(lint('tests/rooms/rooms.test.ts', inProcess, options)).toEqual([]);
    expect(lint('tests/rooms/rooms.ts', inProcess, options)).toHaveLength(1);
    expect(lint('tests/rooms/rooms.test.ts', inProcess)).toHaveLength(1);
    expect(lint('src/editor/editor.files.test.ts', "import { x } from '../extensions/collaboration/model/in-process';", options)).toHaveLength(1);
  });

  it('checks paths in new URL(…, import.meta.url) and vi.mock(…)', () => {
    const worker = "new Worker(new URL('../../hosts/preview/worker/worker.ts', import.meta.url), { type: 'module' });";
    expect(lint('src/extensions/files/files.ts', worker)).toEqual([expect.stringContaining('hosts/preview/preview.ts')]);
    expect(lint('src/extensions/files/files.test.ts', "vi.mock('../../hosts/preview/pages/page-list');")).toHaveLength(1);
    expect(lint('src/hosts/preview/preview.ts', "new URL('./worker/worker.ts', import.meta.url);")).toEqual([]);
    expect(lint('src/extensions/files/files.test.ts', "vi.mock('../../hosts/preview/preview');")).toEqual([]);
  });

  it('ignores generated and data files', () => {
    expect(lint('src/hosts/preview/preview.ts', "import url from '../../core/typst-engine/wasm/typst_engine_bg.wasm?url';")).toEqual([]);
  });
});
