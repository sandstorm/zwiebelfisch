// The pdf-export extension: the project's PDF, made by PdfExport (the command `pdfExport.export`), and the preview's
// "Download PDF" with a menu of the PDF variants other extensions register (comments: without / with them).
// Entry of features/pdf-export/. See ARCHITECTURE.md, "createTypstEditor".
import type { Project } from '../../core/project/project';
import type { Diagnostic, PdfResult } from '../../core/typst-engine/typst-engine';
import { pdfMenu } from '../../hosts/preview/preview';
import type { TypstExtension } from '../../hosts/workbench/workbench';

declare module '../../hosts/workbench/workbench' {
  interface CommandRegistry {
    /** The project's PDF as it is now, or of `entry`; rejects naming the errors (the pdf-export extension). */
    'pdfExport.export': (entry?: PdfEntry) => Promise<Blob>;
  }
}

/**
 * The `pdfExport.export` command and, with `download` (default true), "Download PDF" with its menu of the PDF
 * variants in the preview's toolbar (the plain button makes the first variant).
 */
export function pdfExport(options: { download?: boolean } = {}): TypstExtension {
  return {
    id: 'pdf-export',
    activate({ project, workbench, preview, subscriptions }) {
      const pdfs = new PdfExport(project, preview);
      subscriptions.push(workbench.registerCommand('pdfExport.export', (entry) => pdfs.blob(entry)));
      if (options.download !== false) subscriptions.push(preview.registerToolbarItem(pdfMenu));
    },
  };
}

/** What to compile instead of the main file as it is: another entry file and sources that replace the documents' texts. */
export interface PdfEntry {
  main: string;
  sources: Record<string, string>;
}

/** What makes the PDF: the preview's engine (`Preview.exportPdf`). */
export interface PdfEngine {
  exportPdf(main: string, sources?: Record<string, string>): Promise<PdfResult>;
}

/**
 * The project's PDF as it is now: the main file as compiled, or `entry` (the
 * documents stay as they are). A document with errors gives no PDF but an
 * error saying so, never an older PDF.
 */
export class PdfExport {
  constructor(private readonly project: Project, private readonly engine: PdfEngine) {}

  async blob(entry: PdfEntry = { main: this.project.main, sources: {} }): Promise<Blob> {
    const { pdf, diagnostics } = await this.engine.exportPdf(entry.main, entry.sources);
    if (!pdf) throw new Error(failure(diagnostics));
    return new Blob([pdf as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
  }
}

function failure(diagnostics: Diagnostic[]): string {
  const errors = diagnostics.filter((d) => d.severity === 'error');
  if (errors.length === 0) return 'The document did not compile.';
  if (errors.length === 1) return `The document has 1 error: ${errors[0].message}`;
  return `The document has ${errors.length} errors. The first: ${errors[0].message}`;
}
