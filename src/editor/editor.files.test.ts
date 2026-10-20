// @vitest-environment jsdom
// Tests for editor.ts: the file panel and file links in the composed widget (preview mocked: no worker in jsdom).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { SOURCE_EDITOR } from '../hosts/source-editor/source-editor';
import { createEditor, type EditorOptions } from './editor';

vi.mock('../hosts/preview/preview', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Preview: class {
    onDidLoad = () => ({ dispose() {} });
    onDidCrash = () => ({ dispose() {} });
    isEmpty = true;
    registerPaneOverlay = () => ({ dispose() {} });
    update() {}
    reveal() {}
    snippet = async () => null;
    onDidRender = () => ({ dispose() {} });
    onDidClickPage = () => ({ dispose() {} });
    createPageOverlay = () => ({ set() {}, dispose() {} });
    boxesFor = async () => [];
    onDidChangeDiagnostics = () => ({ dispose() {} });
    zoom = 'fit';
    setZoom() {}
    scale = 1;
    visiblePage = { index: 0, count: 0 };
    onDidChangeView = () => ({ dispose() {} });
    registerPdfExportOption = () => ({ dispose() {} });
    pdfExportOptions = () => [];
    registerViewOption = () => ({ dispose() {} });
    viewOptions = () => [];
    onDidChangeViewOptions = () => ({ dispose() {} });
    engineMemory = 0;
    onDidChangeEngineMemory = () => ({ dispose() {} });
    setViewOptionValues() {}
    registerRenderer = () => ({ dispose() {} });
    renderers = () => [{ id: 'pages', label: 'Pages' }];
    activeRenderer = 'pages';
    setActiveRenderer() {}
    onDidChangeRenderers = () => ({ dispose() {} });
    dispose() {}
  },
}));

function setup(options: EditorOptions) {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createEditor(host, { viewType: SOURCE_EDITOR, ...options });
  const items = () => [...host.querySelectorAll<HTMLElement>('[role=treeitem]')];
  const item = (title: string) => items().find((t) => t.title === title);
  const source = () => {
    const visible = [...host.querySelectorAll<HTMLElement>('.zwf-editor__pane')].find((pane) => !pane.hidden && pane.querySelector('.cm-editor'));
    return EditorView.findFromDOM(visible!.querySelector<HTMLElement>('.cm-editor')!)!;
  };
  const filesOpen = () => !host.querySelector<HTMLElement>('[data-testid=zwf-files]')!.closest<HTMLElement>('.zwf-editor__panel')!.hidden;
  return { host, editor, items, item, source, filesOpen };
}

afterEach(() => {
  document.body.replaceChildren();
  sessionStorage.clear();
});

describe('files and source', () => {
  it('`mainFile` names the main file; `source` and `onDidChangeMainFile` follow when another becomes it, unless locked', async () => {
    const mainFileChanged = vi.fn();
    const files = { '/thesis.typ': '= Thesis', '/a.typ': 'A' };
    const { editor } = setup({ mainFile: { path: '/thesis.typ' }, files });
    editor.onDidChangeMainFile(mainFileChanged);
    expect(editor.source).toBe('= Thesis');
    await editor.executeCommand('files.setMainFile', '/a.typ');
    expect(mainFileChanged).toHaveBeenCalledWith('/a.typ');
    expect(editor.source).toBe('A');
    editor.source = 'A!';
    expect(editor.files['/a.typ']).toBe('A!');
    const locked = setup({ mainFile: { path: '/thesis.typ', locked: true }, files }).editor;
    locked.onDidChangeMainFile(mainFileChanged);
    await locked.executeCommand('files.setMainFile', '/a.typ');
    expect(locked.source).toBe('= Thesis');
    expect(mainFileChanged).toHaveBeenCalledTimes(1);
  });

  it('`files` holds every file, the main one included; `source` is the main file\'s text', () => {
    const { editor } = setup({ files: { '/main.typ': '= Main', '/a.typ': 'A' } });
    expect(editor.files).toEqual({ '/main.typ': '= Main', '/a.typ': 'A' });
    expect(editor.source).toBe('= Main');
    expect(setup({ source: '= Shortcut', files: { '/main.typ': '= Main' } }).editor.source).toBe('= Shortcut');
  });

  it('assigning `files` replaces them all, the main file too, and reports each change', () => {
    const filesChanged = vi.fn();
    const { editor } = setup({ files: { '/main.typ': '= Main', '/a.typ': 'A' } });
    editor.onDidChangeFiles(filesChanged);
    editor.files = { '/main.typ': '= New', '/b.typ': 'B' };
    expect(editor.files).toEqual({ '/main.typ': '= New', '/b.typ': 'B' });
    expect(filesChanged.mock.calls.map(([change]) => change)).toEqual([
      { kind: 'delete', path: '/a.typ' },
      { kind: 'update', path: '/main.typ', content: '= New' },
      { kind: 'create', path: '/b.typ', content: 'B' },
    ]);
    editor.files = { '/c.typ': 'C' }; // the main file cannot be deleted: it stays as it is
    expect(editor.files).toEqual({ '/main.typ': '= New', '/c.typ': 'C' });
  });

  it('assigning `source` is an update of the main file', () => {
    const filesChanged = vi.fn();
    const { editor } = setup({ source: '= Hello' });
    editor.onDidChangeFiles(filesChanged);
    editor.source = '= Bye';
    expect(filesChanged).toHaveBeenLastCalledWith({ kind: 'update', path: '/main.typ', content: '= Bye' });
  });
});

describe('events', () => {
  it('`onDidChangeActiveFile` fires when another file is shown, not for the same one again', () => {
    const { editor } = setup({ files: { '/main.typ': '= Main', '/a.typ': 'A' } });
    const shown = vi.fn();
    editor.onDidChangeActiveFile(shown);
    editor.open('/main.typ');
    editor.open('/a.typ');
    editor.open('/a.typ');
    expect(shown.mock.calls).toEqual([['/a.typ']]);
  });

  it('a disposed subscription hears nothing more, nor does any once the editor is disposed', () => {
    const { editor } = setup({ source: '= Hello', files: { '/a.typ': 'A' } });
    const dropped = vi.fn();
    const kept = vi.fn();
    editor.onDidChangeFiles(dropped).dispose();
    editor.onDidChangeFiles(kept);
    editor.source = '= Bye';
    expect(dropped).not.toHaveBeenCalled();
    expect(kept).toHaveBeenCalledTimes(1);
    const opened = vi.fn();
    editor.onDidChangeActiveFile(opened);
    editor.dispose();
    editor.open('/a.typ');
    expect(opened).not.toHaveBeenCalled();
  });
});

describe('the file panel in the widget', () => {
  it('is collapsed to its rail button for a single file and open with more files (auto)', () => {
    const single = setup({ source: '= Hello' });
    expect(single.filesOpen()).toBe(false);
    expect(single.host.querySelector('[data-testid=zwf-panel-toggle-files]')).not.toBeNull();
    const several = setup({ source: '= Hello', files: { '/chapters/intro.typ': 'Intro' } });
    expect(several.filesOpen()).toBe(true);
    expect(several.items().map((t) => t.title)).toEqual(['main.typ', 'chapters']);
  });

  it('`hide` shows no panel and no rail button; `show` opens it for one file', () => {
    const hidden = setup({ source: '= Hello', files: { '/a.typ': 'A' }, settings: { 'files.panel': 'hide' } });
    expect(hidden.host.querySelector<HTMLElement>('[data-testid=zwf-panel-toggle-files]')!.hidden).toBe(true);
    expect(hidden.filesOpen()).toBe(false);
    expect(setup({ source: '= Hello', settings: { 'files.panel': 'show' } }).filesOpen()).toBe(true);
  });

  it('expanding a folder and clicking a file opens it', () => {
    const { editor, item } = setup({ source: '= Hello', files: { '/chapters/intro.typ': 'Intro' } });
    item('chapters')!.click();
    item('chapters/intro.typ')!.click();
    expect(editor.activeFile).toBe('/chapters/intro.typ');
    expect(item('chapters/intro.typ')!.getAttribute('aria-selected')).toBe('true');
  });
});

describe('file links in the widget', () => {
  const files = { '/template.typ': '#let template(doc) = doc', '/chapters/intro.typ': '#image("../logo.png")' };

  it('Mod+click on an #import path in the Source editor opens the file and the panel shows it', () => {
    const { editor, source, item } = setup({ source: '#import "template.typ": template\n= Hello', files });
    const view = source();
    view.posAtCoords = () => 10;
    view.contentDOM.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, ctrlKey: true }));
    expect(editor.activeFile).toBe('/template.typ');
    expect(item('template.typ')!.getAttribute('aria-selected')).toBe('true');
  });

  it('paths resolve from the folder of the file they are written in', () => {
    const { editor, source, item } = setup({ source: '#include "chapters/intro.typ"', files });
    source().posAtCoords = () => 12;
    source().contentDOM.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, ctrlKey: true }));
    expect(editor.activeFile).toBe('/chapters/intro.typ');
    expect(item('chapters')!.getAttribute('aria-expanded')).toBe('true');
  });
});
