import { ProjectPath } from '../../core/paths/paths';
import type { Project } from '../../core/project/project';
import type { TypstDiagnostic, PdfEntry } from '../../core/typst-engine/typst-engine';
import type { PdfExportOption, PreviewContributions } from '../../hosts/preview/preview';
import type { Extension } from '../../hosts/extension-host/extension-host';
import css from './pdf-export.css?inline';
import { COMMAND, PdfDownload } from './preview/preview';

/**
 * The project's PDF, used by:
 * - hosts, through the command `pdfExport.export(options?: Record<string, boolean>): Promise<Blob>`
 * - users, through "Download PDF" in the preview's toolbar (menu `preview/title`, group `4_export`, the command
 *   `pdfExport.download`), while the setting `pdfExport.download` is on (the default); disabled while it makes a PDF
 *
 * The PDF is the project as it is now, with the export options set by id and the others at their default. A document
 * with errors gives no PDF: the command rejects with the errors, also for an unknown option. "Download PDF" opens a
 * popover with a checkbox per export option, remembered for this viewer.
 */
export function pdfExport(): Extension {
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
    activate({ project, commands, window, workspace, workspaceState, preview, subscriptions }) {
      subscriptions.push(window.registerStyleSheet(css));
      const pdfs = new PdfExport(project, preview);
      subscriptions.push(commands.registerCommand('pdfExport.export', (values?: Record<string, boolean>) => pdfs.blob(values)));
      const download = new PdfDownload(window.ownerDocument, pdfs, workspaceState, window);
      subscriptions.push(
        download,
        preview.registerPaneOverlay(download.element),
        commands.registerCommand(COMMAND, () => download.run()),
        window.registerMenuItem('preview/title', {
          command: COMMAND,
          title: 'Download PDF',
          group: '4_export',
          when: () => workspace.getConfiguration('pdfExport').get('download', true),
          enabled: () => !download.busy,
        }),
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
    const name = `${ProjectPath.name(main).replace(/\.typ$/, '')}.pdf`;
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

function failure(diagnostics: TypstDiagnostic[]): string {
  const errors = diagnostics.filter((d) => d.severity === 'error');
  if (errors.length === 0) return 'The document did not compile.';
  if (errors.length === 1) return `The document has 1 error: ${errors[0].message}`;
  return `The document has ${errors.length} errors. The first: ${errors[0].message}`;
}
