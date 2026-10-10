// @vitest-environment jsdom
// Tests for typst-editor.ts: the built-in extensions in the composed widget, through the workbench's contribution
// points (preview mocked: no worker in jsdom).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import type { Diagnostic } from '../core/typst-engine/typst-engine';
import { pageNumber, pdfMenu, type PdfVariant, type PreviewToolbarItem, zoomControls } from '../hosts/preview/preview';
import { createTypstEditor, type TypstEditorOptions } from './typst-editor';

const exportPdf = vi.fn(async () => ({ pdf: new Uint8Array([37, 80, 68, 70]), diagnostics: [], missingPackages: [] }));
interface FakePreview {
  toolbarItems: PreviewToolbarItem[];
  pdfVariants: PdfVariant[];
  compiled(diagnostics: Diagnostic[]): void;
}
const previews: FakePreview[] = [];

vi.mock('../hosts/preview/preview', async (importOriginal) => {
  const { Disposable } = await import('../core/disposable/disposable');
  const { EventEmitter } = await import('../core/event-emitter/event-emitter');
  const registry = <T>(list: T[]) => (item: T) => {
    list.push(item);
    return new Disposable(() => list.splice(list.indexOf(item), 1));
  };
  return {
    ...(await importOriginal<object>()),
    Preview: class {
      readonly toolbarItems: unknown[] = [];
      readonly pdfVariants: unknown[] = [];
      readonly #diagnostics = new EventEmitter<readonly Diagnostic[]>();
      readonly onDidChangeDiagnostics = this.#diagnostics.event;
      constructor() {
        previews.push(this as never);
      }
      compiled(diagnostics: Diagnostic[]) {
        this.#diagnostics.fire(diagnostics);
      }
      update() {}
      reveal() {}
      snippet = async () => null;
      onDidRender = () => new Disposable(() => {});
      exportPdf = exportPdf;
      registerToolbarItem = registry(this.toolbarItems);
      registerPdfVariant = registry(this.pdfVariants);
      destroy() {}
    },
  };
});

function setup(options: TypstEditorOptions) {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createTypstEditor(host, { mode: 'source', ...options });
  const source = () => {
    const visible = [...host.querySelectorAll<HTMLElement>('.typst-editor__pane')].find((pane) => !pane.hidden && pane.querySelector('.cm-editor'));
    return EditorView.findFromDOM(visible!.querySelector<HTMLElement>('.cm-editor')!)!;
  };
  return { host, editor, source, preview: previews.at(-1)! };
}

function drop(target: HTMLElement, files: File[]) {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { files, types: ['Files'] } });
  target.dispatchEvent(event);
  return event;
}

afterEach(() => {
  document.body.replaceChildren();
  sessionStorage.clear();
  previews.length = 0;
});

describe('file views by kind', () => {
  it('shows an image in the asset view, and a Typst file in the tabs again', () => {
    const { host, editor } = setup({ source: '= Hi', files: { '/logo.png': new Uint8Array([1]) } });
    URL.createObjectURL = vi.fn(() => 'blob:1');
    URL.revokeObjectURL = vi.fn();
    editor.open('/logo.png');
    const asset = host.querySelector<HTMLElement>('[data-testid=typst-asset]')!;
    expect(asset.hidden).toBe(false);
    expect(host.querySelector<HTMLElement>('.typst-editor__tabs')!.hidden).toBe(true);
    editor.open('/main.typ');
    expect(asset.hidden).toBe(true);
    expect(host.querySelector<HTMLElement>('.typst-editor__tabs')!.hidden).toBe(false);
  });

  it('shows a spreadsheet in the spreadsheet view', () => {
    const { host, editor } = setup({ source: '= Hi', files: { '/data.ic': new Uint8Array() } });
    editor.open('/data.ic');
    expect(host.querySelector<HTMLElement>('[data-testid=typst-spreadsheet]')!.hidden).toBe(false);
    expect(host.querySelector('[data-testid=typst-asset]')).toBeNull();
  });
});

describe('the built-in extensions', () => {
  it('uploads files dropped on the widget, unless the file list is hidden', async () => {
    // jsdom's File has no arrayBuffer()
    const png = Object.assign(new File([new Uint8Array([1])], 'cat.png', { type: 'image/png' }), {
      arrayBuffer: async () => new Uint8Array([1]).buffer,
    });
    const shown = setup({ source: '= Hi' });
    expect(drop(shown.host, [png]).defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(Object.keys(shown.editor.files)).toContain('/cat.png'));
    const hidden = setup({ source: '= Hi', fileList: 'hide' });
    expect(drop(hidden.host, [png]).defaultPrevented).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(Object.keys(hidden.editor.files)).toEqual(['/main.typ']);
  });

  it('adds a comment on Ctrl/Cmd+Alt+M in the Source view, before the editor sees the key', () => {
    const { editor, source } = setup({ source: 'Hi\n' });
    const view = source();
    view.dispatch({ selection: { anchor: 2 } });
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', altKey: true, ctrlKey: true, bubbles: true }));
    expect(editor.source).toContain('Hi#margin-note[]');
  });

  it('counts the diagnostics in the status bar and underlines them in the Source view', async () => {
    const { host, preview } = setup({ source: '= Hi' });
    preview.compiled([{ severity: 'error', message: 'oops', hints: [], path: '/main.typ', from: 0, to: 1 }]);
    const status = host.querySelector('.typst-editor__status-bar [data-testid=typst-status]')!;
    expect(status.textContent).toContain('1 error');
    await vi.waitFor(() => expect(host.querySelector('.cm-lintRange-error')).not.toBeNull());
  });

  it('marks the diagnostics in the Visual view, message and hints as tooltip, also in views made later', () => {
    const { host, editor, preview } = setup({ mode: 'visual', source: 'Hello world.\n', files: { '/a.typ': '#foo\n\nText.\n' } });
    preview.compiled([
      { severity: 'error', message: 'unknown variable: foo', hints: ['did you mean bar?'], path: '/main.typ', from: 6, to: 11 },
      // in raw code (a block atom), of a file whose views do not exist yet
      { severity: 'warning', message: 'unused', hints: [], path: '/a.typ', from: 1, to: 4 },
    ]);
    const mark = host.querySelector<HTMLElement>('.ProseMirror .typst-diagnostic')!;
    expect(mark.textContent).toBe('world');
    expect(mark.dataset.severity).toBe('error');
    expect(mark.title).toBe('unknown variable: foo\nhint: did you mean bar?');
    editor.open('/a.typ');
    const shown = [...host.querySelectorAll<HTMLElement>('.typst-editor__pane')].find((pane) => !pane.hidden)!;
    expect(shown.querySelector<HTMLElement>('.typst-diagnostic')?.dataset.severity).toBe('warning');
  });

  it('fills the preview toolbar: zoom, "Follow cursor", page number, then "Download PDF" unless told not to', () => {
    const { preview } = setup({ source: '= Hi' });
    expect(preview.toolbarItems).toHaveLength(4);
    expect([preview.toolbarItems[0], preview.toolbarItems[2], preview.toolbarItems[3]]).toEqual([zoomControls, pageNumber, pdfMenu]);
    expect(setup({ source: '= Hi', pdfDownload: false }).preview.toolbarItems).not.toContain(pdfMenu);
  });

  it('exports the PDF through the pdf-export extension, which offers it without and with comments', async () => {
    const { editor, preview } = setup({ source: '= Hi' });
    const blob = await editor.exportPdf({ comments: true });
    expect(blob.type).toBe('application/pdf');
    expect(exportPdf).toHaveBeenCalledWith('/main.typ', {});
    expect(preview.pdfVariants.map((variant) => variant.label)).toEqual(['Without comments', 'With comments']);
    expect((await preview.pdfVariants[1].create()).name).toBe('main-with-comments.pdf');
  });

  it('removes everything it added on destroy', () => {
    const { host, editor } = setup({ source: '= Hi', files: { '/a.typ': 'A' } });
    editor.destroy();
    expect(host.children).toHaveLength(0);
    expect(host.classList.contains('typst-editor')).toBe(false);
  });
});
