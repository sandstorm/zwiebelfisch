// Tests for pdf-export.ts.
import { describe, expect, it, vi } from 'vitest';
import { Project } from '../../core/project/project';
import type { Diagnostic, PdfResult } from '../../core/typst-engine/typst-engine';
import { PdfExport } from './pdf-export';
import { ProjectPath } from '../../core/paths/paths';

const path = ProjectPath.of;

const TEXT = 'Text\n';
const pdf = new TextEncoder().encode('%PDF-1.7');

function setup(result: Partial<PdfResult> = {}, main = path('/main.typ')) {
  const project = new Project(main, { [main]: TEXT, '/logo.png': new Uint8Array([1]) });
  const exportPdf = vi.fn(async (_main: string, _sources?: Record<string, string>) => ({ pdf, diagnostics: [], missingPackages: [], ...result }));
  return { exportPdf, pdfs: new PdfExport(project, { exportPdf }) };
}

const error = (message: string): Diagnostic => ({ severity: 'error', message, hints: [], path: path('/main.typ'), from: 0, to: 1 });

describe('PdfExport', () => {
  it('exports the main file as it is', async () => {
    const { exportPdf, pdfs } = setup();
    const blob = await pdfs.blob();
    expect(blob.type).toBe('application/pdf');
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(pdf);
    expect(exportPdf).toHaveBeenCalledWith(path('/main.typ'), {});
  });

  it('exports another entry with replaced sources, without touching the documents', async () => {
    const { exportPdf, pdfs } = setup();
    await pdfs.blob({ main: '/entry.typ', sources: { '/entry.typ': '#include "/main.typ"' } });
    expect(exportPdf).toHaveBeenCalledWith('/entry.typ', { '/entry.typ': '#include "/main.typ"' });
  });

  it('rejects with the errors instead of giving a stale PDF', async () => {
    const { pdfs } = setup({ pdf: null, diagnostics: [error('unknown variable: oops'), error('second')] });
    await expect(pdfs.blob()).rejects.toThrow('The document has 2 errors. The first: unknown variable: oops');
    const one = setup({ pdf: null, diagnostics: [{ ...error('only warnings'), severity: 'warning' }, error('broken')] });
    await expect(one.pdfs.blob()).rejects.toThrow('The document has 1 error: broken');
    await expect(setup({ pdf: null }).pdfs.blob()).rejects.toThrow('The document did not compile.');
  });
});
