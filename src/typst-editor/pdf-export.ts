// PdfExport: the widget's PDF of the project, with or without comments (exportPdf, "Download PDF").
// See typst-editor.ts and ARCHITECTURE.md, "createTypstEditor".
import { withoutNotes } from '../features/comments/comments';
import type { Project } from '../core/project/project';
import type { Diagnostic, PdfResult } from '../core/typst-engine/typst-engine';
import type { PdfFile } from '../hosts/preview/preview';

/** What makes the PDF: the preview's engine (`Preview.exportPdf`). */
export interface PdfEngine {
  exportPdf(main: string, sources?: Record<string, string>): Promise<PdfResult>;
}

/**
 * The project's PDF as it is now: with comments it is the main file as
 * compiled; without, the margin notes are left out (`withoutNotes`), the
 * documents stay as they are. A document with errors gives no PDF but an
 * error saying so, never an older PDF.
 */
export class PdfExport {
  constructor(private readonly project: Project, private readonly engine: PdfEngine) {}

  async blob(comments: boolean): Promise<Blob> {
    const main = this.project.main;
    const entry = comments ? { main, sources: {} } : withoutNotes(this.project.files(), main);
    const { pdf, diagnostics } = await this.engine.exportPdf(entry.main, entry.sources);
    if (!pdf) throw new Error(failure(diagnostics));
    return new Blob([pdf as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
  }

  /** The PDF and its file name: `main.pdf`, or `main-with-comments.pdf`, after the main file. */
  async file(comments: boolean): Promise<PdfFile> {
    const base = this.project.main.slice(this.project.main.lastIndexOf('/') + 1).replace(/\.typ$/, '');
    return { blob: await this.blob(comments), name: `${base}${comments ? '-with-comments' : ''}.pdf` };
  }
}

function failure(diagnostics: Diagnostic[]): string {
  const errors = diagnostics.filter((d) => d.severity === 'error');
  if (errors.length === 0) return 'The document did not compile.';
  if (errors.length === 1) return `The document has 1 error: ${errors[0].message}`;
  return `The document has ${errors.length} errors. The first: ${errors[0].message}`;
}
