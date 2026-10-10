// Tests for preview.ts: the PDF without and with comments, made through the `pdfExport.export` command.
import { describe, expect, it, vi } from 'vitest';
import { Project } from '../../../core/project/project';
import { ProjectPath } from '../../../core/paths/paths';
import type { PdfVariant, PreviewContributions } from '../../../hosts/preview/preview';
import { CommentsPdf, registerPdfVariants } from './preview';

const path = ProjectPath.of;

const NOTED = '#import "@preview/drafting:0.2.2": margin-note\nText#margin-note[a note]\n';

function setup(main = path('/main.typ')) {
  const project = new Project(main, { [main]: NOTED, '/logo.png': new Uint8Array([1]) });
  const blob = new Blob(['%PDF-1.7'], { type: 'application/pdf' });
  const executeCommand = vi.fn(async (_id: 'pdfExport.export', _entry?: { main: string; sources: Record<string, string> }) => blob);
  return { project, executeCommand, blob, pdfs: new CommentsPdf(project, { executeCommand } as never) };
}

describe('CommentsPdf', () => {
  it('exports the main file as it is with comments', async () => {
    const { executeCommand, blob, pdfs } = setup();
    expect(await pdfs.blob(true)).toBe(blob);
    expect(executeCommand).toHaveBeenCalledWith('pdfExport.export', undefined);
  });

  it('exports a generated entry without the notes, without touching the documents', async () => {
    const { executeCommand, project, pdfs } = setup();
    await pdfs.blob(false);
    const [, entry] = executeCommand.mock.calls[0];
    expect(entry!.main).not.toBe(path('/main.typ'));
    expect(entry!.sources['/main.typ']).toBe('#import "@preview/drafting:0.2.2": margin-note\nText\n');
    expect(entry!.sources[entry!.main]).toContain('#include "/main.typ"');
    expect(project.document(path('/main.typ'))!.text).toBe(NOTED);
  });

  it('names the file after the main file', async () => {
    expect((await setup().pdfs.file(false)).name).toBe('main.pdf');
    expect((await setup(path('/thesis/report.typ')).pdfs.file(true)).name).toBe('report-with-comments.pdf');
  });

  it('offers "Without comments" first, then "With comments"', async () => {
    const variants: PdfVariant[] = [];
    const preview = { registerPdfVariant: (variant: PdfVariant) => (variants.push(variant), { dispose: () => variants.splice(variants.indexOf(variant), 1) }) };
    const registration = registerPdfVariants(preview as unknown as PreviewContributions, setup().pdfs);
    expect(variants.map((variant) => variant.label)).toEqual(['Without comments', 'With comments']);
    expect((await variants[1].create()).name).toBe('main-with-comments.pdf');
    registration.dispose();
    expect(variants).toEqual([]);
  });
});
