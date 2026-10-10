// Tests for pdf-export.ts.
import { describe, expect, it, vi } from 'vitest';
import { Project } from '../core/project/project';
import type { Diagnostic, PdfResult } from '../core/typst-engine/typst-engine';
import { PdfExport } from './pdf-export';
import { ProjectPath } from '../core/paths/paths';

const path = ProjectPath.of;

const NOTED = '#import "@preview/drafting:0.2.2": margin-note\nText#margin-note[a note]\n';
const pdf = new TextEncoder().encode('%PDF-1.7');

function setup(result: Partial<PdfResult> = {}, main = path('/main.typ')) {
  const project = new Project(main, { [main]: NOTED, '/logo.png': new Uint8Array([1]) });
  const exportPdf = vi.fn(async (_main: string, _sources?: Record<string, string>) => ({ pdf, diagnostics: [], missingPackages: [], ...result }));
  return { exportPdf, pdfs: new PdfExport(project, { exportPdf }) };
}

const error = (message: string): Diagnostic => ({ severity: 'error', message, hints: [], path: path('/main.typ'), from: 0, to: 1 });

describe('PdfExport', () => {
  it('exports the main file as it is with comments', async () => {
    const { exportPdf, pdfs } = setup();
    const blob = await pdfs.blob(true);
    expect(blob.type).toBe('application/pdf');
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(pdf);
    expect(exportPdf).toHaveBeenCalledWith(path('/main.typ'), {});
  });

  it('exports a generated entry without the notes, without touching the documents', async () => {
    const { exportPdf, pdfs } = setup();
    await pdfs.blob(false);
    const [main, sources] = exportPdf.mock.calls[0];
    expect(main).not.toBe(path('/main.typ'));
    expect(sources!['/main.typ']).toBe('#import "@preview/drafting:0.2.2": margin-note\nText\n');
    expect(sources![main]).toContain('#include "/main.typ"');
  });

  it('names the file after the main file', async () => {
    expect((await setup().pdfs.file(false)).name).toBe('main.pdf');
    expect((await setup({}, path('/thesis/report.typ')).pdfs.file(true)).name).toBe('report-with-comments.pdf');
  });

  it('rejects with the errors instead of giving a stale PDF', async () => {
    const { pdfs } = setup({ pdf: null, diagnostics: [error('unknown variable: oops'), error('second')] });
    await expect(pdfs.blob(false)).rejects.toThrow('The document has 2 errors. The first: unknown variable: oops');
    const one = setup({ pdf: null, diagnostics: [{ ...error('only warnings'), severity: 'warning' }, error('broken')] });
    await expect(one.pdfs.blob(true)).rejects.toThrow('The document has 1 error: broken');
    await expect(setup({ pdf: null }).pdfs.blob(true)).rejects.toThrow('The document did not compile.');
  });
});
