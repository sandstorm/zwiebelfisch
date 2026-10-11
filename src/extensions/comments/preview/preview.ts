// The PDF export option "Include comments" and the view option "Comments". See comments in ../comments.ts.
import type { Disposable } from '../../../core/disposable/disposable';
import type { Project } from '../../../core/project/project';
import type { PdfEntry } from '../../../core/typst-engine/typst-engine';
import type { PreviewContributions, PreviewEntry } from '../../../hosts/preview/preview';
import { includingMain, noteDefaultsPrelude } from '../model/note-defaults';
import { withoutNotes } from '../model/without-notes';

/**
 * `comments.include` (default off: the final version): with it the PDF shows the margin notes as the preview does, a
 * generated entry giving them `NOTE_STYLE` before it includes the main file; without, they are left out of copies of
 * the sources (`withoutNotes`). The documents stay as they are.
 */
export function registerIncludeComments(preview: Pick<PreviewContributions, 'registerPdfExportOption'>, project: Project): Disposable {
  return preview.registerPdfExportOption({
    id: 'comments.include',
    label: 'Include comments',
    description: 'With the margin notes as the preview shows them; without, the final version',
    default: false,
    apply: (entry, include) => (include ? withNoteStyle(project, entry) : withoutComments(project, entry)),
  });
}

/**
 * `comments.show`, "Comments" in the View menu (default on). On, the preview's prelude gives the notes `NOTE_STYLE`,
 * when the project imports drafting. Off, the preview draws the document as if it had no margin notes. The notes stay
 * in the sources (positions, clicks and the cursor must match them), so the prelude leaves drafting's drawings out by
 * show rules: a margin note's box (its connector and the note, labelled `<margin-note>`) and the marks around a range
 * note's text (`<inline-note>`), whose text stays. The Visual editor's markers and the PDF (`comments.include`) are
 * not affected.
 */
export function registerShowComments(preview: Pick<PreviewContributions, 'registerViewOption'>, project: Project): Disposable {
  return preview.registerViewOption({
    id: 'comments.show',
    label: 'Comments',
    description: 'The margin notes in the preview (the PDF has "Include comments")',
    default: true,
    apply: (entry, show) => {
      const lines = show ? noteDefaultsPrelude(project.files(), NOTE_STYLE) : HIDE_NOTES;
      return lines.length === 0 ? entry : { ...entry, prelude: [...entry.prelude, ...lines] };
    },
  });
}

/**
 * The notes' look, the arguments of drafting's `set-margin-note-defaults`: small text in a box tinted like the Visual
 * editor's notes (which is also the range highlight), a thin amber border and connector. The editor sets it where it
 * compiles (the preview's prelude, the PDF's entry), never in the documents, so they stay plain drafting. It runs
 * before the main file: a document's own `set-margin-note-defaults` comes later and wins for what it sets.
 */
const NOTE_STYLE = `
  stroke: rgb("#e0a800") + 0.5pt,
  fill: rgb("#fabe1447"),
  rect: (body, ..args) => rect(radius: 2pt, inset: 3pt, ..args, {
    set text(size: 8pt)
    set list(indent: 0pt, body-indent: 0.3em)
    body
  }),
`;

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

/** `entry` with the notes given `NOTE_STYLE` by a generated entry that includes its main file. */
function withNoteStyle(project: Project, entry: PdfEntry): PdfEntry {
  const files = { ...project.files(), ...entry.sources };
  const style = noteDefaultsPrelude(files, NOTE_STYLE);
  if (style.length === 0) return entry;
  const styled = includingMain(files, entry.main, '/.with-comments.typ', style);
  return { main: styled.main, sources: { ...entry.sources, ...styled.sources } };
}
