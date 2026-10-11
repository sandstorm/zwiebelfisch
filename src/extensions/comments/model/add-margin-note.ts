// The source edits for a new margin note (and its import). See comments in ../comments.ts.
import type { SyntaxNode } from '@lezer/common';
import { typstParser } from 'codemirror-lang-typst/lezer';
import { DRAFTING, isNoteCallAt, MARGIN_NOTE, NOTE_HEAD, printNoteCall, rangeNoteSyntax } from './margin-note-syntax';
import { SourceOffset, type SourceRange, type TextChange } from '../../../core/typst-document/typst-document';
import { calculateImportChange } from '../../../core/typst-syntax/typst-syntax';
import { calculatePageMarginChanges } from './page-margin';

/**
 * The edits that add a `drafting` margin note at `range` of Typst `text`:
 * a selection becomes the highlighted text of a range note,
 * `#margin-note[selection][]` (bold or italic text the selection starts or
 * ends with goes inside whole: `#margin-note[*bold*][]`, as the Visual editor
 * prints it); a collapsed range (or a selection that is not
 * self-contained markup, e.g. half of `*bold*` or two paragraphs) gets a point
 * note `#margin-note[]` at its end. The file imports `margin-note` from
 * `drafting` exactly once afterwards: an existing drafting import is extended,
 * else one is added at the top. The notes' look is not written into the
 * document: the preview and the PDF set it (NOTE_STYLE in ../preview/preview.ts).
 * Page margins drafting 0.2.2 cannot handle (a single length) get room for
 * notes on the right (see `calculatePageMarginChanges`).
 *
 * Null where no note fits (the position is inside code).
 */
export function calculateMarginNoteChanges(text: string, range: SourceRange): MarginNoteChanges | null {
  const note = noteEdit(text, range);
  if (!note) return null;
  const changes = [...withImport(text, note), ...calculatePageMarginChanges(text)].sort((a, b) => a.from - b.from);
  // Every note edit ends with `[]` inserted where the call ends: the body is just before that `]`.
  return { changes, note: SourceOffset.of(mapOffset(changes, note.at(-1)!.from) - 1) };
}

/** Where a new note goes in the edited text: its (still empty) body starts at `note`. */
export interface MarginNoteChanges {
  changes: TextChange[];
  note: SourceOffset;
}

/** The note itself: around the formatting the selection starts or ends with, else around the selection as is. */
function noteEdit(text: string, range: { from: number; to: number }): TextChange[] | null {
  const { open, close } = rangeNoteSyntax(NOTE_HEAD, '');
  for (const { from, to } of [aroundFormatting(text, range), range]) {
    if (from < to && fits(text, [from, open], [to, close])) return [insert(from, open), insert(to, close)];
  }
  const { to } = range;
  const point = printNoteCall({ head: NOTE_HEAD, note: '' });
  if (fits(text, [to, point])) return [insert(to, point)];
  return null;
}

/**
 * `range` grown over the delimiters of bold and italic text it starts or ends
 * with (`bold` in `*bold*` becomes `*bold*`). The Visual editor maps a selected
 * bold word to the text between the stars, and prints a range note around its
 * formatting (the note's mark is the outermost), so a note made like this
 * keeps its source when the Visual editor prints it again.
 */
function aroundFormatting(text: string, { from, to }: { from: number; to: number }): { from: number; to: number } {
  const tree = typstParser.parse(text);
  for (let grown = from < to; grown; ) {
    grown = false;
    tree.iterate({
      from,
      to,
      enter: ({ node }) => {
        const markup = delimitedMarkup(node);
        if (!markup) return;
        if (markup.from === from && markup.to <= to) [from, grown] = [node.from, true];
        if (markup.to === to && markup.from >= from) [to, grown] = [node.to, true];
      },
    });
  }
  return { from, to };
}

/** The text between the delimiters of `*bold*` or `_italic_` markup (both present); null for anything else. */
function delimitedMarkup(node: SyntaxNode): SyntaxNode | null {
  if (node.name !== 'Strong' && node.name !== 'Emph') return null;
  const markup = node.getChild('Markup');
  const [first, last] = [node.firstChild, node.lastChild];
  return markup && first && last && first !== last && first.name === last.name ? markup : null;
}

/** Whether inserting `parts` (offset, text; ascending) into `text` yields one margin note call that ends with the last part. */
function fits(text: string, ...parts: [number, string][]): boolean {
  let result = '';
  let last = 0;
  for (const [at, part] of parts) {
    result += text.slice(last, at) + part;
    last = at;
  }
  const end = result.length;
  result += text.slice(last);
  return isNoteCallAt(result, parts[0][0], end);
}

function insert(at: number, text: string): TextChange {
  return { from: SourceOffset.of(at), to: SourceOffset.of(at), insert: text };
}

/**
 * `changes` (the note's, the first one at the start of its call) plus
 * whatever makes `margin-note` imported from drafting there; an import at the
 * note's position goes first.
 */
function withImport(text: string, changes: TextChange[]): TextChange[] {
  const extra = marginNoteImport(text, changes[0].from);
  if (!extra) return changes;
  const same = changes.find((change) => change.from === extra.from);
  if (same) return changes.map((change) => (change === same ? { ...same, insert: extra.insert + same.insert } : change));
  return [extra, ...changes].sort((a, b) => a.from - b.from);
}

/** Null when `margin-note` is imported from drafting before `use` already; else the edit that imports it (see `calculateImportChange`). */
function marginNoteImport(text: string, use: SourceOffset): TextChange | null {
  const version = DRAFTING.slice(0, DRAFTING.lastIndexOf(':') + 1);
  return calculateImportChange(text, { name: MARGIN_NOTE, matches: (module) => module.startsWith(version), create: () => `#import "${DRAFTING}": ${MARGIN_NOTE}\n`, use });
}

/** Where pre-change `offset` ends up; inserts at `offset` itself go before it. */
function mapOffset(changes: readonly TextChange[], offset: number): number {
  let delta = 0;
  for (const change of changes) {
    if (change.from <= offset) delta += change.insert.length - (Math.min(change.to, offset) - change.from);
  }
  return offset + delta;
}
