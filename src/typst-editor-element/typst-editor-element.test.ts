// @vitest-environment jsdom
// Tests for typst-editor-element.ts: options, attributes, `value` / `files` and the events (preview mocked: no worker in jsdom).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { defineTypstEditorElement, type TypstEditorChangeDetail, type TypstEditorElement } from './typst-editor-element';
import type { FileChange, Project } from '../core/project/project';
import { ProjectPath } from '../core/paths/paths';
import { SOURCE_EDITOR } from '../hosts/source-editor/source-editor';

vi.mock('../hosts/preview/preview', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Preview: class {
    update() {}
    reveal() {}
    snippet = async () => null;
    onDidRender = () => ({ dispose() {} });
    onDidClickPage = () => ({ dispose() {} });
    onDidChangeDiagnostics = () => ({ dispose() {} });
    registerToolbarItem = () => ({ dispose() {} });
    registerPdfExportOption = () => ({ dispose() {} });
    pdfExportOptions = () => [];
    registerViewOption = () => ({ dispose() {} });
    viewOptions = () => [];
    onDidChangeViewOptions = () => ({ dispose() {} });
    engineMemory = 0;
    onDidChangeEngineMemory = () => ({ dispose() {} });
    setViewOptionValues() {}
    dispose() {}
  },
}));

defineTypstEditorElement();

function element(html = '<typst-editor></typst-editor>'): TypstEditorElement {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content.firstElementChild as TypstEditorElement;
}

function events(el: TypstEditorElement) {
  const changes: TypstEditorChangeDetail[] = [];
  const fileChanges: FileChange[] = [];
  el.addEventListener('change', (event) => changes.push((event as CustomEvent<TypstEditorChangeDetail>).detail));
  el.addEventListener('files-change', (event) => fileChanges.push((event as CustomEvent<FileChange>).detail));
  return { changes, fileChanges };
}

afterEach(() => {
  document.body.replaceChildren();
  sessionStorage.clear();
});

describe('<typst-editor>', () => {
  it('starts from `options` (files with the main file, its path)', () => {
    const el = element();
    el.options = { mainFile: { path: '/thesis.typ' }, files: { '/thesis.typ': '= Thesis', '/a.typ': 'A' } };
    document.body.append(el);
    expect(el.value).toBe('= Thesis');
    expect(el.files).toEqual({ '/thesis.typ': '= Thesis', '/a.typ': 'A' });
  });

  it('takes the text content, and the `value` attribute over it and over `options.source`', () => {
    const inline = element('<typst-editor>\n  = Inline\n</typst-editor>');
    inline.options = { source: '= Option' };
    document.body.append(inline);
    expect(inline.value).toBe('= Inline\n');
    const attribute = element('<typst-editor value="= Attribute">= Inline</typst-editor>');
    document.body.append(attribute);
    expect(attribute.value).toBe('= Attribute');
    const option = element();
    option.options = { source: '= Option' };
    document.body.append(option);
    expect(option.value).toBe('= Option');
  });

  it('takes the source written inside it without the indentation HTML gives it', () => {
    const value = (html: string) => {
      const el = element(`<typst-editor>${html}</typst-editor>`);
      document.body.append(el);
      return el.value;
    };
    expect(value('\n      = Title\n\n      - item\n        nested\n    ')).toBe('= Title\n\n- item\n  nested\n');
    expect(value('\n= Title\nBody\n')).toBe('= Title\nBody\n');
    // blank lines don't count for the indentation
    expect(value('\n    a\n\n  \n    b')).toBe('a\n\n\nb\n');
  });

  it('maps the settings attribute (JSON) onto the settings, over options.settings, also when it changes', () => {
    const el = element(`<typst-editor settings='{"workbench.theme": "dark"}'></typst-editor>`);
    el.options = { settings: { 'workbench.theme': 'light', 'files.panel': 'show' } };
    document.body.append(el);
    const widget = () => el.shadowRoot!.querySelector<HTMLElement>('.typst-editor')!;
    expect(widget().dataset.theme).toBe('dark');
    expect(el.settings).toEqual({ 'workbench.theme': 'dark', 'files.panel': 'show' });
    el.setAttribute('settings', '{"workbench.theme": "auto"}');
    expect(widget().dataset.theme).toBe('auto');
    el.settings = {};
    expect(widget().dataset.theme).toBeUndefined();
  });

  it('ignores a settings attribute that is not a JSON object, with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = element(`<typst-editor settings="dark"></typst-editor>`);
    document.body.append(el);
    expect(el.settings).toEqual({});
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not a JSON object'));
    warn.mockRestore();
  });

  it('forwards `open`, and runs commands', async () => {
    const el = element();
    el.options = { files: { '/main.typ': '= Main', '/a.typ': 'A' } };
    document.body.append(el);
    const opened: unknown[] = [];
    el.addEventListener('open', (event) => opened.push((event as CustomEvent).detail));
    await el.executeCommand('documentLinks.createFile', '/b.typ');
    expect(el.files['/b.typ']).toBe('');
    expect(opened).toEqual([{ path: '/b.typ' }]);
  });

  it('fires `change` per edited file with its path and content, and `files-change` with the change', () => {
    const el = element();
    el.options = { viewType: SOURCE_EDITOR, files: { '/main.typ': '= Main', '/a.typ': 'A' } };
    document.body.append(el);
    const { changes, fileChanges } = events(el);
    const view = EditorView.findFromDOM(el.shadowRoot!.querySelector<HTMLElement>('.cm-editor')!)!;
    view.dispatch({ changes: { from: view.state.doc.length, insert: '!' } });
    expect(changes).toEqual([{ path: '/main.typ', content: '= Main!' }]);
    expect(fileChanges).toEqual([{ kind: 'update', path: '/main.typ', content: '= Main!' }]);
  });

  it('fires `main-file-change` with the path when another file becomes the main file', () => {
    const el = element();
    let project: Project | undefined;
    const probe = { id: 'probe', activate: (context: { project: Project }) => void (project = context.project) };
    el.options = { files: { '/main.typ': '= Main', '/a.typ': 'A' }, extensions: (builtins) => [...builtins, probe] };
    document.body.append(el);
    const details: unknown[] = [];
    el.addEventListener('main-file-change', (event) => details.push((event as CustomEvent).detail));
    project!.setMain(ProjectPath.of('/a.typ'));
    expect(details).toEqual([{ path: '/a.typ' }]);
    expect(el.value).toBe('A');
  });

  it('dispatches nothing when the host sets `value` or `files`', () => {
    const el = element();
    el.options = { source: '= Main' };
    document.body.append(el);
    const { changes, fileChanges } = events(el);
    el.value = '= New';
    el.files = { '/b.typ': 'B' };
    expect(el.files).toEqual({ '/main.typ': '= New', '/b.typ': 'B' });
    expect(changes).toEqual([]);
    expect(fileChanges).toEqual([]);
  });

  it('takes `options`, `value` and `files` set before the element was defined', () => {
    const el = document.createElement('late-editor') as TypstEditorElement;
    el.options = { viewType: SOURCE_EDITOR, files: { '/a.typ': 'A' } };
    el.value = '= Early';
    document.body.append(el);
    defineTypstEditorElement('late-editor');
    expect(el.value).toBe('= Early');
    expect(el.files).toEqual({ '/main.typ': '= Early', '/a.typ': 'A' });
  });

  it('keeps text and files when moved', () => {
    const el = element();
    el.options = { files: { '/main.typ': '= Main' } };
    document.body.append(el);
    el.files = { '/main.typ': '= Edited', '/a.typ': 'A' };
    el.remove();
    expect(el.files).toEqual({ '/main.typ': '= Edited', '/a.typ': 'A' });
    document.body.append(el);
    expect(el.value).toBe('= Edited');
    expect(el.files).toEqual({ '/main.typ': '= Edited', '/a.typ': 'A' });
  });
});
