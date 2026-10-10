// What the comments extension contributes to the preview: the PDF export option "Include comments". The PDF itself
// is the pdf-export extension's; comments only decide what it compiles. Entry of extensions/comments/preview/.
// See ARCHITECTURE.md, "Comments = margin notes".
import type { Disposable } from '../../../core/disposable/disposable';
import type { Project } from '../../../core/project/project';
import type { PdfEntry, PreviewContributions } from '../../../hosts/preview/preview';
import { withoutNotes } from '../model/model';

/**
 * `comments.include` (default off: the final version): with it the PDF shows the margin notes as the preview does;
 * without, they are left out of copies of the sources (`withoutNotes`), the documents stay as they are.
 */
export function registerIncludeComments(preview: Pick<PreviewContributions, 'registerPdfExportOption'>, project: Project): Disposable {
  return preview.registerPdfExportOption({
    id: 'comments.include',
    label: 'Include comments',
    description: 'With the margin notes as the preview shows them; without, the final version',
    default: false,
    apply: (entry, include) => (include ? entry : withoutComments(project, entry)),
  });
}

/** `entry` with the notes left out of its sources and of the project's other `.typ` files. */
function withoutComments(project: Project, entry: PdfEntry): PdfEntry {
  const stripped = withoutNotes({ ...project.files(), ...entry.sources }, entry.main);
  return { main: stripped.main, sources: { ...entry.sources, ...stripped.sources } };
}
