// What the comments extension contributes to the preview: the PDF variants "Without comments" and "With comments".
// The PDF itself is the pdf-export extension's (its command `pdfExport.export`); comments only decide what it
// compiles. Entry of extensions/comments/preview/. See ARCHITECTURE.md, "Comments = margin notes".
import { Disposable } from '../../../core/disposable/disposable';
import type { Project } from '../../../core/project/project';
import type { PdfFile, PreviewContributions } from '../../../hosts/preview/preview';
import type { Workbench } from '../../../hosts/workbench/workbench';
import { withoutNotes } from '../model/model';

/**
 * The project's PDF with or without its comments: with them it is the main file as compiled; without, the margin
 * notes are left out of copies of the sources (`withoutNotes`), the documents stay as they are. Made by the
 * `pdfExport.export` command, so it rejects like it (naming the errors, never an older PDF).
 */
export class CommentsPdf {
  constructor(private readonly project: Project, private readonly workbench: Pick<Workbench, 'executeCommand'>) {}

  blob(withComments: boolean): Promise<Blob> {
    const entry = withComments ? undefined : withoutNotes(this.project.files(), this.project.main);
    return this.workbench.executeCommand('pdfExport.export', entry);
  }

  /** The PDF and its file name: `main.pdf`, or `main-with-comments.pdf`, after the main file. */
  async file(withComments: boolean): Promise<PdfFile> {
    const main = this.project.main;
    const base = main.slice(main.lastIndexOf('/') + 1).replace(/\.typ$/, '');
    return { blob: await this.blob(withComments), name: `${base}${withComments ? '-with-comments' : ''}.pdf` };
  }
}

/**
 * The preview's PDF variants: "Without comments" first (the plain "Download PDF" makes it: the usual final
 * version), then "With comments".
 */
export function registerPdfVariants(preview: PreviewContributions, pdfs: CommentsPdf): Disposable {
  return Disposable.from(
    preview.registerPdfVariant({ label: 'Without comments', create: () => pdfs.file(false) }),
    preview.registerPdfVariant({ label: 'With comments', create: () => pdfs.file(true) }),
  );
}
