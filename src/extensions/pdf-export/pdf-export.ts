// The pdf-export extension: the project's PDF, made by PdfExport (the command `pdfExport.export`), and the preview's
// "Download PDF" with a popover of the export options other extensions register (comments: include them or not).
// Entry of extensions/pdf-export/. See ARCHITECTURE.md, "createTypstEditor".
// Why an extension: the preview's engine can make a PDF and keeps the options registered with it, but how they are
// offered (one button, a checkbox each, remembered per viewer) and whether a widget has a download button at all is
// this extension's policy.
import { Disposable } from '../../core/disposable/disposable';
import type { Project } from '../../core/project/project';
import type { Diagnostic, PdfEntry } from '../../core/typst-engine/typst-engine';
import type { PdfExportOption, PreviewContributions } from '../../hosts/preview/preview';
import type { TypstExtension } from '../../hosts/workbench/workbench';
import css from './pdf-export.css?inline';
import { downloadPdf } from './preview/preview';

/**
 * The command `pdfExport.export(options?: Record<string, boolean>): Promise<Blob>`: the project's PDF as it is now,
 * with the export options set as given (by id; the others at their default); rejects naming the errors, or an
 * unknown option. And, while the setting `pdfExport.download` is on (default), "Download PDF" in the preview's
 * toolbar: a popover with a checkbox per registered export option (remembered for this viewer) and "Download", or,
 * without options, the download at once.
 */
export function pdfExport(): TypstExtension {
  return {
    id: 'pdf-export',
    contributes: {
      configuration: {
        properties: {
          'pdfExport.download': {
            type: 'boolean',
            default: true,
            description: 'Whether the preview toolbar has "Download PDF" (with the export options). The command pdfExport.export works either way.',
          },
        },
      },
    },
    activate({ project, workspace, workbench, preview, subscriptions }) {
      subscriptions.push(workbench.registerStyleSheet(css));
      const pdfs = new PdfExport(project, preview);
      subscriptions.push(workbench.registerCommand('pdfExport.export', (values?: Record<string, boolean>) => pdfs.blob(values)));
      const download = downloadPdf(pdfs, workbench.remember('pdf-export.options'), workbench);
      let button: Disposable | null = null;
      const show = () => {
        const wanted = workspace.getConfiguration('pdfExport').get('download', true);
        if (wanted === (button !== null)) return;
        button?.dispose();
        button = wanted ? preview.registerToolbarItem(download, { group: '3_export', order: 10 }) : null;
      };
      show();
      subscriptions.push(
        workspace.onDidChangeConfiguration((event) => {
          if (event.affectsConfiguration('pdfExport.download')) show();
        }),
        new Disposable(() => button?.dispose()),
      );
    },
  };
}

/**
 * The project's PDF as it is now: the main file as compiled, changed by every registered export option in turn
 * (`PdfExportOption.apply`; the documents stay as they are). A document with errors gives no PDF but an error
 * saying so, never an older PDF.
 */
class PdfExport {
  constructor(
    private readonly project: Project,
    private readonly preview: Pick<PreviewContributions, 'exportPdf' | 'pdfExportOptions'>,
  ) {}

  /** The options an export offers, in the order they are applied. */
  options(): readonly PdfExportOption[] {
    return this.preview.pdfExportOptions();
  }

  /** The PDF with the options set as in `values` (by id), the others at their default. Rejects for an unknown id. */
  async blob(values: Record<string, boolean> = {}): Promise<Blob> {
    const entry = this.entry(values);
    const { pdf, diagnostics } = await this.preview.exportPdf(entry);
    if (!pdf) throw new Error(failure(diagnostics));
    return new Blob([pdf as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
  }

  /** The PDF and its file name, after the main file (`main.pdf`). */
  async file(values: Record<string, boolean> = {}): Promise<{ blob: Blob; name: string }> {
    const main = this.project.main;
    const name = `${main.slice(main.lastIndexOf('/') + 1).replace(/\.typ$/, '')}.pdf`;
    return { blob: await this.blob(values), name };
  }

  private entry(values: Record<string, boolean>): PdfEntry {
    const options = this.options();
    const unknown = Object.keys(values).filter((id) => !options.some((option) => option.id === id));
    if (unknown.length > 0) throw new Error(`Unknown PDF export option: ${unknown.join(', ')}`);
    let entry: PdfEntry = { main: this.project.main, sources: {} };
    for (const option of options) entry = option.apply(entry, values[option.id] ?? option.default);
    return entry;
  }
}

function failure(diagnostics: Diagnostic[]): string {
  const errors = diagnostics.filter((d) => d.severity === 'error');
  if (errors.length === 0) return 'The document did not compile.';
  if (errors.length === 1) return `The document has 1 error: ${errors[0].message}`;
  return `The document has ${errors.length} errors. The first: ${errors[0].message}`;
}
