// @vitest-environment jsdom
// Tests for text-files.ts in a workbench: which files open in the text editor, saving into the project, changes from
// elsewhere (preview mocked: no worker in jsdom).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { Disposable } from '../../core/disposable/disposable';
import { ProjectPath } from '../../core/paths/paths';
import { Project, type FileChange } from '../../core/project/project';
import type { Window } from '../../hosts/window/window';
import { WorkbenchHost } from '../../hosts/workbench/workbench';
import { textFiles } from './text-files';
import { SAVE_DELAY } from './workbench/text-file-editor';

vi.mock('../../hosts/preview/preview', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Preview: class {
    update() {}
    onDidRender = () => new Disposable(() => {});
    dispose() {}
  },
}));

const path = ProjectPath.of;

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
  sessionStorage.clear();
});

function setup(allowFileChange?: (change: FileChange) => boolean) {
  const host = document.body.appendChild(document.createElement('div'));
  const project = new Project(path('/main.typ'), { '/main.typ': '#bibliography("refs.bib")\n', '/refs.bib': '@book{a}\n' });
  const workbench = new WorkbenchHost(host, project, { allowFileChange });
  let window!: Window;
  workbench.activate([textFiles(), { id: 'probe', activate: (context) => void (window = context.window) }]);
  const view = () => EditorView.findFromDOM(host.querySelector<HTMLElement>('[data-view-type="textFiles.editor"] .cm-editor')!)!;
  return { host, project, workbench, window, view };
}

describe('text files', () => {
  it('opens data, bibliography, text, Markdown and Mermaid files in the text editor, with its icon', () => {
    const { host, project, workbench, window } = setup();
    for (const name of ['data.csv', 'data.json', 'conf.yaml', 'conf.yml', 'Cargo.toml', 'feed.xml', 'notes.txt', 'README.md', 'flow.mmd']) {
      project.apply({ kind: 'create', path: path(`/${name}`), content: `${name}\n` });
      workbench.open(path(`/${name}`));
      const editor = host.querySelector('[data-view-type="textFiles.editor"] [data-testid=typst-text-file]');
      expect(editor?.querySelector('.cm-content')?.textContent, name).toBe(name);
      expect(window.getFileIcon(path(`/${name}`)), name).toContain('<svg');
    }
    project.apply({ kind: 'create', path: path('/logo.svg'), content: '<svg/>' });
    workbench.open(path('/logo.svg'));
    expect(host.querySelector('[data-testid=typst-text-file]')).toBeNull();
  });

  it('saves an edit of a .bib into the project, at once when the file is closed', async () => {
    vi.useFakeTimers();
    const { project, workbench, view } = setup();
    workbench.open(path('/refs.bib'));
    view().dispatch({ changes: { from: view().state.doc.length, insert: '@book{b}\n' } });
    vi.advanceTimersByTime(SAVE_DELAY);
    await vi.waitFor(() => expect(project.content(path('/refs.bib'))).toBe('@book{a}\n@book{b}\n'));
    view().dispatch({ changes: { from: 0, insert: '% refs\n' } });
    workbench.open(path('/main.typ'));
    await vi.waitFor(() => expect(project.content(path('/refs.bib'))).toBe('% refs\n@book{a}\n@book{b}\n'));
  });

  it('shows changes made elsewhere (bytes as UTF-8) in the open editor', () => {
    const { project, workbench, view } = setup();
    workbench.open(path('/refs.bib'));
    project.apply({ kind: 'update', path: path('/refs.bib'), content: new TextEncoder().encode('@book{ä}\n') });
    expect(view().state.doc.toString()).toBe('@book{ä}\n');
  });

  it('a refused save is an error message', async () => {
    vi.useFakeTimers();
    const { host, workbench, view } = setup(() => false);
    workbench.open(path('/refs.bib'));
    view().dispatch({ changes: { from: 0, insert: 'x' } });
    vi.advanceTimersByTime(SAVE_DELAY);
    await vi.waitFor(() => expect(host.querySelector('[data-testid=typst-notifications] [role=alert]')?.textContent).toContain('refs.bib not saved'));
  });
});
