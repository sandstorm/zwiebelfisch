// The pdf-export extension: the project's PDF, with or without comments (the host's `exportPdf`, the preview's
// "Download PDF"), made by PdfExport. Entry of extensions/pdf-export/. See ARCHITECTURE.md, "createTypstEditor".
// Why an extension: the preview's engine can make a PDF, but which PDFs a widget offers, and whether it has a
// download button at all, is configuration; the menu (preview/) only lists the variants registered with the preview.
import type { Project } from '../../core/project/project';
import type { Diagnostic, PdfResult } from '../../core/typst-engine/typst-engine';
import type { PdfFile } from '../../hosts/preview/preview';
import { pdfMenu } from './preview/preview';
import type { TypstExtension } from '../../hosts/workbench/workbench';
import { withoutNotes } from '../../features/comments/comments';

declare module '../../hosts/workbench/workbench' {
  interface CommandRegistry {
    /** The project's PDF as it is now, with or without the comments; rejects naming the errors (the pdf-export extension). */
    'pdfExport.export': (comments: boolean) => Promise<Blob>;
  }
}

/**
 * The `pdfExport.export` command, the preview's PDF variants "Without comments" (first: the plain "Download PDF"
 * makes it, the usual final version) and "With comments", and, with `download` (default true), "Download PDF"
 * with its menu of the variants in the preview's toolbar.
 */
export function pdfExport(options: { download?: boolean } = {}): TypstExtension {
  return {
    id: 'pdf-export',
    activate({ project, workbench, preview, subscriptions }) {
      const pdfs = new PdfExport(project, preview);
      subscriptions.push(
        workbench.registerCommand('pdfExport.export', (comments) => pdfs.blob(comments)),
        preview.registerPdfVariant({ label: 'Without comments', create: () => pdfs.file(false) }),
        preview.registerPdfVariant({ label: 'With comments', create: () => pdfs.file(true) }),
      );
      if (options.download !== false) subscriptions.push(preview.registerToolbarItem(pdfMenu));
    },
  };
}

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
