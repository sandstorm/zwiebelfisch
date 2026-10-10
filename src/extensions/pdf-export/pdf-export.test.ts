// Tests for pdf-export.ts.
import { describe, expect, it, vi } from 'vitest';
import { Project } from '../../core/project/project';
import type { Diagnostic, PdfEntry, PdfResult } from '../../core/typst-engine/typst-engine';
import type { PdfExportOption } from '../../hosts/preview/preview';
import { PdfExport } from './pdf-export';
import { ProjectPath } from '../../core/paths/paths';

const path = ProjectPath.of;

const TEXT = 'Text\n';
const pdf = new TextEncoder().encode('%PDF-1.7');

function setup(result: Partial<PdfResult> = {}, main = path('/main.typ'), options: PdfExportOption[] = []) {
  const project = new Project(main, { [main]: TEXT, '/logo.png': new Uint8Array([1]) });
  const exportPdf = vi.fn(async (_entry: PdfEntry) => ({ pdf, diagnostics: [], missingPackages: [], ...result }));
  return { exportPdf, pdfs: new PdfExport(project, { exportPdf, pdfExportOptions: () => options }) };
}

const error = (message: string): Diagnostic => ({ severity: 'error', message, hints: [], path: path('/main.typ'), from: 0, to: 1 });

/** An option that, when on, adds a source naming itself and what it was applied to. */
const marker = (id: string, value = false): PdfExportOption => ({
  id,
  label: id,
  default: value,
  apply: (entry, on) => (on ? { main: entry.main, sources: { ...entry.sources, [`/${id}.typ`]: Object.keys(entry.sources).join(',') } } : entry),
});

describe('PdfExport', () => {
  it('exports the main file as it is', async () => {
    const { exportPdf, pdfs } = setup();
    const blob = await pdfs.blob();
    expect(blob.type).toBe('application/pdf');
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(pdf);
    expect(exportPdf).toHaveBeenCalledWith({ main: path('/main.typ'), sources: {} });
  });

  it('applies every option in order, each to what the ones before made, with the values given or their default', async () => {
    const { exportPdf, pdfs } = setup({}, path('/main.typ'), [marker('a.first', true), marker('b.off'), marker('c.last')]);
    await pdfs.blob({ 'c.last': true });
    expect(exportPdf).toHaveBeenCalledWith({ main: '/main.typ', sources: { '/a.first.typ': '', '/c.last.typ': '/a.first.typ' } });
    await pdfs.blob({ 'a.first': false });
    expect(exportPdf).toHaveBeenLastCalledWith({ main: '/main.typ', sources: {} });
  });

  it('rejects an option nobody registered', async () => {
    const { exportPdf, pdfs } = setup({}, path('/main.typ'), [marker('comments.include')]);
    await expect(pdfs.blob({ 'comments.includ': true })).rejects.toThrow('Unknown PDF export option: comments.includ');
    expect(exportPdf).not.toHaveBeenCalled();
  });

  it('names the file after the main file', async () => {
    expect((await setup().pdfs.file()).name).toBe('main.pdf');
    expect((await setup({}, path('/thesis/report.typ')).pdfs.file()).name).toBe('report.pdf');
  });

  it('rejects with the errors instead of giving a stale PDF', async () => {
    const { pdfs } = setup({ pdf: null, diagnostics: [error('unknown variable: oops'), error('second')] });
    await expect(pdfs.blob()).rejects.toThrow('The document has 2 errors. The first: unknown variable: oops');
    const one = setup({ pdf: null, diagnostics: [{ ...error('only warnings'), severity: 'warning' }, error('broken')] });
    await expect(one.pdfs.blob()).rejects.toThrow('The document has 1 error: broken');
    await expect(setup({ pdf: null }).pdfs.blob()).rejects.toThrow('The document did not compile.');
  });
});
