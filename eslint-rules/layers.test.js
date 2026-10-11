// Tests for the layer rules as eslint.config.js configures them (local/dependencies, no-restricted-imports,
// no-restricted-globals, no-restricted-types), run against the real src/ tree: each rule fails where it should and
// lets through what the layers allow.
import path from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import { dependencyViolation } from './dependencies.js';

const root = path.resolve(import.meta.dirname, '..');
const eslint = new ESLint({ cwd: root });

/** The ids of the rules `code` breaks as the file `file` (path from the repository root). */
async function broken(file, code) {
  const [result] = await eslint.lintText(code, { filePath: path.join(root, file) });
  return result.messages.map((message) => message.ruleId);
}

describe('layers', () => {
  it('keeps extensions apart, also through a relative path', async () => {
    expect(await broken('src/extensions/styles/styles.ts', "import { labels } from '../labels/labels';")).toEqual(['local/dependencies']);
    expect(await broken('src/extensions/styles/styles.test.ts', "import { labels } from '../labels/labels';")).toEqual(['local/dependencies']);
    expect(await broken('src/extensions/styles/styles.ts', "import { TypstStyleIndex } from './model/typst-style-index';")).toEqual([]);
  });

  it('keeps hosts free of extensions, typst-editor/ and testing/', async () => {
    expect(await broken('src/hosts/workbench/workbench.ts', "import { files } from '../../extensions/files/files';")).toEqual(['local/dependencies']);
    expect(await broken('src/hosts/workbench/workbench.test.ts', "import { schema } from '../../testing/testing';")).toEqual(['local/dependencies']);
    expect(await broken('src/hosts/workbench/workbench.ts', "import { Preview } from '../preview/preview';")).toEqual([]);
  });

  it('keeps ui/ to core/: no host, extension or testing/ (popup-menu is the only widget)', async () => {
    const file = 'src/ui/popup-menu/popup-menu.ts';
    expect(await broken(file, "import { Preview } from '../../hosts/preview/preview';")).toEqual(['local/dependencies']);
    expect(await broken(file, "import { files } from '../../extensions/files/files';")).toEqual(['local/dependencies']);
    expect(await broken('src/ui/popup-menu/popup-menu.test.ts', "import { schema } from '../../testing/testing';")).toEqual(['local/dependencies']);
    expect(await broken(file, "import { Disposable } from '../../core/disposable/disposable';")).toEqual([]);
    expect(await broken('src/ui/popup-menu/popup-menu.test.ts', "import { PopupMenu } from './popup-menu';")).toEqual([]);
  });

  it('lets only tests import testing/', async () => {
    expect(await broken('src/typst-editor/typst-editor.ts', "import { schema } from '../testing/testing';")).toEqual(['local/dependencies']);
    expect(await broken('src/typst-editor/typst-editor.files.test.ts', "import { schema } from '../testing/testing';")).toEqual([]);
  });

  it('keeps core to core: no other folder, no Yjs, no editor library, no DOM', async () => {
    const file = 'src/core/project/project.ts';
    expect(await broken(file, "import { Preview } from '../../hosts/preview/preview';")).toEqual(['local/dependencies']);
    expect(await broken(file, "import * as Y from 'yjs';")).toEqual(['no-restricted-imports']);
    expect(await broken(file, "import { EditorState } from '@codemirror/state';")).toEqual(['no-restricted-imports']);
    expect(await broken(file, "import { basicSetup } from 'codemirror';")).toEqual(['no-restricted-imports']);
    expect(await broken(file, "import { typstParser } from 'codemirror-lang-typst/lezer';")).toEqual([]);
    expect(await broken(file, 'export const width = window.innerWidth;')).toEqual(['no-restricted-globals']);
  });

  it("keeps an extension's model/ pure: no editor library, no DOM, no view folder, no host or ui/", async () => {
    const file = 'src/extensions/labels/model/label-index.ts';
    expect(await broken(file, "import { Node } from '@tiptap/pm/model';")).toEqual(['no-restricted-imports']);
    expect(await broken(file, 'export const body = document.body;')).toEqual(['no-restricted-globals']);
    expect(await broken(file, 'export let element: HTMLElement | undefined;')).toEqual(['@typescript-eslint/no-restricted-types']);
    expect(await broken(file, "import { references } from '../visual-view/visual-view';")).toEqual(['local/dependencies']);
    expect(await broken(file, "import { PopupMenu } from '../../../ui/popup-menu/popup-menu';")).toEqual(['local/dependencies']);
    expect(await broken(file, "import type { Workbench } from '../../../hosts/workbench/workbench';")).toEqual(['local/dependencies']);
    expect(await broken(file, "import { ProjectPath } from '../../../core/paths/paths';")).toEqual([]);
    expect(await broken(file, "import { scan } from './scan';")).toEqual([]);
    expect(await broken(file, "import * as Y from 'yjs';")).toEqual([]);
  });
});

describe('dependencyViolation', () => {
  it("puts what `importers` captured into `forbidden`", () => {
    const rules = [{ importers: '^src/extensions/([^/]+)/', forbidden: '^src/extensions/(?!$1/)', message: 'apart' }];
    expect(dependencyViolation('src/extensions/a.b/x.ts', 'src/extensions/a.b/y.ts', rules)).toBeNull();
    expect(dependencyViolation('src/extensions/a.b/x.ts', 'src/extensions/axb/y.ts', rules)).toBe('apart');
  });
});
