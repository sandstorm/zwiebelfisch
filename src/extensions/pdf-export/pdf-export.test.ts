// @vitest-environment jsdom
// Tests for pdf-export.ts: the command `pdfExport.export`, the toolbar entry and the file "Download PDF" saves, over a fake context.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Disposable } from '../../core/disposable/disposable';
import { ProjectPath } from '../../core/paths/paths';
import { Project } from '../../core/project/project';
import type { TypstDiagnostic, PdfEntry, PdfResult } from '../../core/typst-engine/typst-engine';
import type { PdfExportOption } from '../../hosts/preview/preview';
import type { MenuItem } from '../../hosts/commands/commands';
import type { ExtensionContext } from '../../hosts/extension-host/extension-host';
import { pdfExport } from './pdf-export';
import { SourceOffset } from '../../core/typst-document/typst-document';

const path = ProjectPath.of;

const TEXT = 'Text\n';
const pdf = new TextEncoder().encode('%PDF-1.7');

afterEach(() => vi.restoreAllMocks());

/** The extension activated over a project with `main` and a preview whose PDF export gives `result`. */
function setup(result: Partial<PdfResult> = {}, main = path('/main.typ'), options: PdfExportOption[] = []) {
  const project = new Project(main, { [main]: TEXT, '/logo.png': new Uint8Array([1]) });
  const exportPdf = vi.fn(async (_entry: PdfEntry) => ({ pdf, diagnostics: [], missingPackages: [], ...result }));
  const commands = new Map<string, (...args: unknown[]) => unknown>();
  const menu: [string, MenuItem][] = [];
  const context = {
    project,
    subscriptions: [],
    workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }), onDidChangeConfiguration: () => new Disposable(() => {}) },
    commands: {
      registerCommand: (id: string, handler: (...args: unknown[]) => unknown) => (commands.set(id, handler), new Disposable(() => commands.delete(id))),
    },
    window: {
      ownerDocument: document,
      showErrorMessage: async () => undefined,
      registerStyleSheet: () => new Disposable(() => {}),
      registerMenuItem: (menuId: string, item: MenuItem) => (menu.push([menuId, item]), new Disposable(() => {})),
    },
    workspaceState: { get: (_key: string, fallback?: unknown) => fallback, update: async () => {}, keys: () => [] },
    preview: {
      exportPdf,
      pdfExportOptions: () => options,
      registerPaneOverlay: (element: HTMLElement) => (document.body.append(element), new Disposable(() => element.remove())),
    },
  };
  pdfExport().activate(context as unknown as ExtensionContext);
  const exportCommand = (values?: Record<string, boolean>) => commands.get('pdfExport.export')!(values) as Promise<Blob>;
  /** The name "Download PDF" saves the PDF under. */
  const downloadName = async () => {
    const saved = new Promise<string>((resolve) => {
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
        resolve(this.download);
      });
    });
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:pdf', revokeObjectURL: () => {} }));
    void commands.get('pdfExport.download')!();
    return saved;
  };
  return { exportPdf, exportCommand, downloadName, menu };
}

/** A blob's bytes (jsdom's Blob has no `arrayBuffer`). */
const bytes = (blob: Blob) =>
  new Promise<ArrayBuffer>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.readAsArrayBuffer(blob);
  });

const error = (message: string): TypstDiagnostic => ({ severity: 'error', message, hints: [], path: path('/main.typ'), from: SourceOffset.of(0), to: SourceOffset.of(1) });

/** An option that, when on, adds a source naming itself and what it was applied to. */
const marker = (id: string, value = false): PdfExportOption => ({
  id,
  label: id,
  default: value,
  apply: (entry, on) => (on ? { main: entry.main, sources: { ...entry.sources, [`/${id}.typ`]: Object.keys(entry.sources).join(',') } } : entry),
});

describe('pdfExport', () => {
  it('exports the main file as it is', async () => {
    const { exportPdf, exportCommand } = setup();
    const blob = await exportCommand();
    expect(blob.type).toBe('application/pdf');
    expect([...new Uint8Array(await bytes(blob))]).toEqual([...pdf]);
    expect(exportPdf).toHaveBeenCalledWith({ main: path('/main.typ'), sources: {} });
  });

  it('applies every option in order, each to what the ones before made, with the values given or their default', async () => {
    const { exportPdf, exportCommand } = setup({}, path('/main.typ'), [marker('a.first', true), marker('b.off'), marker('c.last')]);
    await exportCommand({ 'c.last': true });
    expect(exportPdf).toHaveBeenCalledWith({ main: '/main.typ', sources: { '/a.first.typ': '', '/c.last.typ': '/a.first.typ' } });
    await exportCommand({ 'a.first': false });
    expect(exportPdf).toHaveBeenLastCalledWith({ main: '/main.typ', sources: {} });
  });

  it('rejects an option nobody registered', async () => {
    const { exportPdf, exportCommand } = setup({}, path('/main.typ'), [marker('comments.include')]);
    await expect(exportCommand({ 'comments.includ': true })).rejects.toThrow('Unknown PDF export option: comments.includ');
    expect(exportPdf).not.toHaveBeenCalled();
  });

  it('puts "Download PDF" into the preview toolbar while pdfExport.download is on', () => {
    const [[menuId, item]] = setup().menu;
    expect([menuId, item.command, item.title, item.group, item.when?.({}), item.enabled?.({})]).toEqual(['preview/title', 'pdfExport.download', 'Download PDF', '4_export', true, true]);
  });

  it('downloads the file under the name of the main file', async () => {
    expect(await setup().downloadName()).toBe('main.pdf');
    vi.restoreAllMocks();
    expect(await setup({}, path('/thesis/report.typ')).downloadName()).toBe('report.pdf');
  });

  it('rejects with the errors instead of giving a stale PDF', async () => {
    const { exportCommand } = setup({ pdf: null, diagnostics: [error('unknown variable: oops'), error('second')] });
    await expect(exportCommand()).rejects.toThrow('The document has 2 errors. The first: unknown variable: oops');
    const one = setup({ pdf: null, diagnostics: [{ ...error('only warnings'), severity: 'warning' }, error('broken')] });
    await expect(one.exportCommand()).rejects.toThrow('The document has 1 error: broken');
    await expect(setup({ pdf: null }).exportCommand()).rejects.toThrow('The document did not compile.');
  });
});
