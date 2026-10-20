// @vitest-environment jsdom
// Tests for text-files.ts in the composed hosts (Widget): which files open in the text editor, saving into the project, changes from
// elsewhere (preview mocked: no worker in jsdom).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { Disposable } from '../../core/disposable/disposable';
import { ProjectPath } from '../../core/paths/paths';
import { Project, type FileChange } from '../../core/project/project';
import { SourceRange } from '../../core/typst-document/typst-document';
import type { SourceEditorContributions } from '../../hosts/source-editor/source-editor';
import type { WindowApi } from '../../hosts/window/window';
import { Widget } from '../../editor/widget/widget';
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
  const widget = new Widget(host, project, { allowFileChange });
  let window!: WindowApi;
  let sourceEditor!: SourceEditorContributions;
  widget.activate([textFiles(), { id: 'probe', activate: (context) => void ((window = context.window), (sourceEditor = context.sourceEditor)) }]);
  const view = () => EditorView.findFromDOM(host.querySelector<HTMLElement>('[data-view-type="textFiles.editor"] .cm-editor')!)!;
  return { host, project, widget, window, sourceEditor, view };
}

describe('text files', () => {
  it('opens data, bibliography, text, Markdown and Mermaid files in the text editor, with its icon', () => {
    const { host, project, widget, window } = setup();
    for (const name of ['data.csv', 'data.json', 'conf.yaml', 'conf.yml', 'Cargo.toml', 'feed.xml', 'notes.txt', 'README.md', 'flow.mmd']) {
      project.apply({ kind: 'create', path: path(`/${name}`), content: `${name}\n` });
      widget.window.showDocument(path(`/${name}`));
      const editor = host.querySelector('[data-view-type="textFiles.editor"] [data-testid=zwf-text-file]');
      expect(editor?.querySelector('.cm-content')?.textContent, name).toBe(name);
      expect(window.getFileIcon(path(`/${name}`)), name).toContain('<svg');
    }
    project.apply({ kind: 'create', path: path('/logo.svg'), content: '<svg/>' });
    widget.window.showDocument(path('/logo.svg'));
    expect(host.querySelector('[data-testid=zwf-text-file]')).toBeNull();
  });

  it('saves an edit of a .bib into the project, at once when the file is closed', async () => {
    vi.useFakeTimers();
    const { project, widget, view } = setup();
    widget.window.showDocument(path('/refs.bib'));
    view().dispatch({ changes: { from: view().state.doc.length, insert: '@book{b}\n' } });
    vi.advanceTimersByTime(SAVE_DELAY);
    await vi.waitFor(() => expect(project.content(path('/refs.bib'))).toBe('@book{a}\n@book{b}\n'));
    view().dispatch({ changes: { from: 0, insert: '% refs\n' } });
    widget.window.showDocument(path('/main.typ'));
    await vi.waitFor(() => expect(project.content(path('/refs.bib'))).toBe('% refs\n@book{a}\n@book{b}\n'));
  });

  it('takes the CodeMirror extensions for every CodeMirror (the look), also those registered while it is open', () => {
    const { widget, sourceEditor, view } = setup();
    widget.window.showDocument(path('/refs.bib'));
    expect(view().state.facet(EditorView.darkTheme)).toBe(false);
    sourceEditor.registerCodeMirrorExtension({}, EditorView.darkTheme.of(true));
    expect(view().state.facet(EditorView.darkTheme)).toBe(true);
  });

  it('selects the range opened with (widget.window.showDocument with a selection), in a new editor and in the shown one', () => {
    const { widget, view } = setup();
    widget.window.showDocument(path('/refs.bib'), { selection: SourceRange.of({ from: 1, to: 5 }) });
    expect(view().state.selection.main).toMatchObject({ from: 1, to: 5 });
    widget.window.showDocument(path('/refs.bib'), { selection: SourceRange.of({ from: 6, to: 7 }) });
    expect(view().state.selection.main).toMatchObject({ from: 6, to: 7 });
  });

  it('shows changes made elsewhere (bytes as UTF-8) in the open editor', () => {
    const { project, widget, view } = setup();
    widget.window.showDocument(path('/refs.bib'));
    project.apply({ kind: 'update', path: path('/refs.bib'), content: new TextEncoder().encode('@book{ä}\n') });
    expect(view().state.doc.toString()).toBe('@book{ä}\n');
  });

  it('gives the CodeMirror extensions its kind, language (by ending: a .bib is bibtex) and file', () => {
    const host = document.body.appendChild(document.createElement('div'));
    const project = new Project(path('/main.typ'), { '/main.typ': '= Main\n', '/refs.bib': '@book{a}\n' });
    const widget = new Widget(host, project);
    const seen: string[] = [];
    widget.activate([
      textFiles(),
      {
        id: 'every',
        activate: ({ sourceEditor, subscriptions }) => subscriptions.push(sourceEditor.registerCodeMirrorExtension({}, ({ editor, languageId, path }) => (seen.push(`${editor} ${languageId} ${path()}`), []))),
      },
    ]);
    widget.window.showDocument(path('/refs.bib'));
    expect(seen).toContain('other bibtex /refs.bib');
  });

  it('a refused save is an error message', async () => {
    vi.useFakeTimers();
    const { host, widget, view } = setup(() => false);
    widget.window.showDocument(path('/refs.bib'));
    view().dispatch({ changes: { from: 0, insert: 'x' } });
    vi.advanceTimersByTime(SAVE_DELAY);
    await vi.waitFor(() => expect(host.querySelector('[data-testid=zwf-notifications] [role=alert]')?.textContent).toContain('refs.bib not saved'));
  });
});
