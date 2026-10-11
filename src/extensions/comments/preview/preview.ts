// The PDF export option "Include comments" and the view option "Comments". See comments in ../comments.ts.
import type { Disposable } from '../../../core/disposable/disposable';
import type { Project } from '../../../core/project/project';
import type { PdfEntry } from '../../../core/typst-engine/typst-engine';
import type { PreviewContributions, PreviewEntry } from '../../../hosts/preview/preview';
import { withoutNotes } from '../model/without-notes';

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

/**
 * `comments.show`, "Comments" in the View menu (default on): without, the preview draws the document as if it had no
 * margin notes. The notes stay in the sources (positions, clicks and the cursor must match them), so the preview's
 * prelude leaves drafting's drawings out by show rules: a margin note's box (its connector and the note, labelled
 * `<margin-note>`) and the marks around a range note's text (`<inline-note>`), whose text stays. The Visual editor's
 * markers and the PDF (`comments.include`) are not affected.
 */
export function registerShowComments(preview: Pick<PreviewContributions, 'registerViewOption'>): Disposable {
  return preview.registerViewOption({
    id: 'comments.show',
    label: 'Comments',
    description: 'The margin notes in the preview (the PDF has "Include comments")',
    default: true,
    apply: (entry, show) => (show ? entry : { ...entry, prelude: [...entry.prelude, ...HIDE_NOTES] }),
  });
}

/** Typst that draws drafting's margin notes as nothing, keeping the text of range notes; it imports nothing. */
const HIDE_NOTES: PreviewEntry['prelude'] = [
  '#let comments-margin-note(it) = it.has("body") and it.body.func() == [].func() and it.body.children.any(part => part.func() == place and part.body.has("label") and part.body.label == <margin-note>)',
  '#show box: it => if comments-margin-note(it) { none } else { it }',
  // a range note's text between its marks; an inline note of its own (a box, not underlined) goes
  '#show <inline-note>: it => if it.func() != underline { none } else if it.body.func() != [].func() { it } else { it.body.children.map(part => if part.func() == highlight { part.body.body } else if part.func() == underline { part.body }).join() }',
];

/** `entry` with the notes left out of its sources and of the project's other `.typ` files. */
function withoutComments(project: Project, entry: PdfEntry): PdfEntry {
  const stripped = withoutNotes({ ...project.files(), ...entry.sources }, entry.main);
  return { main: stripped.main, sources: { ...entry.sources, ...stripped.sources } };
}
