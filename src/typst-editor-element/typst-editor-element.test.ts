// @vitest-environment jsdom
// Tests for typst-editor-element.ts: options, attributes, `value` / `files` and the events (preview mocked: no worker in jsdom).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { defineTypstEditorElement, type TypstEditorChangeDetail, type TypstEditorElement } from './typst-editor-element';
import type { FileChange } from '../typst-editor/typst-editor';

vi.mock('../hosts/preview/preview', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Preview: class {
    update() {}
    reveal() {}
    snippet = async () => null;
    onDidRender = () => ({ dispose() {} });
    onDidChangeDiagnostics = () => ({ dispose() {} });
    registerToolbarItem = () => ({ dispose() {} });
    registerPdfExportOption = () => ({ dispose() {} });
    pdfExportOptions = () => [];
    destroy() {}
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
  it('starts from `options` (files with the main file, main path)', () => {
    const el = element();
    el.options = { main: '/thesis.typ', files: { '/thesis.typ': '= Thesis', '/a.typ': 'A' } };
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

  it('lets attributes win over options', () => {
    const el = element('<typst-editor theme="dark" pdf-download="hide"></typst-editor>');
    el.options = { theme: 'light', pdfDownload: true };
    document.body.append(el);
    expect(el.shadowRoot!.querySelector<HTMLElement>('.typst-editor')!.dataset.theme).toBe('dark');
  });

  it('fires `change` per edited file with its path and content, and `files-change` with the change', () => {
    const el = element();
    const onFilesChange = vi.fn();
    el.options = { mode: 'source', files: { '/main.typ': '= Main', '/a.typ': 'A' }, onFilesChange };
    document.body.append(el);
    const { changes, fileChanges } = events(el);
    const view = EditorView.findFromDOM(el.shadowRoot!.querySelector<HTMLElement>('.cm-editor')!)!;
    view.dispatch({ changes: { from: view.state.doc.length, insert: '!' } });
    expect(changes).toEqual([{ path: '/main.typ', content: '= Main!' }]);
    expect(fileChanges).toEqual([{ kind: 'update', path: '/main.typ', content: '= Main!' }]);
    expect(onFilesChange).toHaveBeenCalledWith({ kind: 'update', path: '/main.typ', content: '= Main!' });
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
    el.options = { mode: 'source', files: { '/a.typ': 'A' } };
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
