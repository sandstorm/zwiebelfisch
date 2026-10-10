import type { SyntaxNode } from '@lezer/common';
import { typstParser } from 'codemirror-lang-typst/lezer';
import { DRAFTING, isNoteCallAt, MARGIN_NOTE, NOTE_HEAD, printNoteCall, rangeNoteSyntax } from '../document/margin-note-syntax';
import type { TextChange } from '../document/typst-document';

/** Where a new note goes in the edited text: its (still empty) body starts at `note`. */
export interface AddedNote {
  changes: TextChange[];
  note: number;
}

/**
 * The edits that add a `drafting` margin note at `range` of Typst `text`:
 * a selection becomes the highlighted text of a range note,
 * `#margin-note[selection][]`; a collapsed range (or a selection that is not
 * self-contained markup, e.g. half of `*bold*` or two paragraphs) gets a point
 * note `#margin-note[]` at its end. The file imports `margin-note` from
 * `drafting` exactly once afterwards: an existing drafting import is extended,
 * else one is added at the top.
 *
 * Null where no note fits (the position is inside code).
 */
export function addMarginNote(text: string, range: { from: number; to: number }): AddedNote | null {
  const note = noteEdit(text, range);
  if (!note) return null;
  const changes = withImport(text, note);
  // Every note edit ends with `[]` inserted at `range.to`: the body is just before that `]`.
  return { changes, note: mapOffset(changes, range.to) - 1 };
}

/** The note itself. */
function noteEdit(text: string, { from, to }: { from: number; to: number }): TextChange[] | null {
  const { open, close } = rangeNoteSyntax(NOTE_HEAD, '');
  if (from < to && fits(text, [from, open], [to, close])) return [insert(from, open), insert(to, close)];
  const point = printNoteCall({ head: NOTE_HEAD, note: '' });
  if (fits(text, [to, point])) return [insert(to, point)];
  return null;
}

function insert(at: number, text: string): TextChange {
  return { from: at, to: at, insert: text };
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

/** `changes` plus whatever makes `margin-note` imported from drafting; an import at a note's position goes first. */
function withImport(text: string, changes: TextChange[]): TextChange[] {
  const extra = importChange(text);
  if (!extra) return changes;
  const same = changes.find((change) => change.from === extra.from);
  if (same) return changes.map((change) => (change === same ? { ...same, insert: extra.insert + same.insert } : change));
  return [extra, ...changes].sort((a, b) => a.from - b.from);
}

/** Null when `margin-note` is imported from drafting already. */
function importChange(text: string): TextChange | null {
  for (const node of topLevel(text)) {
    if (node.name !== 'ModuleImport' || !isDrafting(text, node)) continue;
    const items = node.getChild('ImportItems');
    if (node.getChild('Star') || (items && importsMarginNote(text, items))) return null;
    if (items) return insert(items.lastChild!.to, `, ${MARGIN_NOTE}`);
    const str = node.getChild('Str')!;
    if (str.to === node.to) return insert(str.to, `: ${MARGIN_NOTE}`);
  }
  return insert(0, `#import "${DRAFTING}": ${MARGIN_NOTE}\n`);
}

/** Code at the top level of the file (what follows a `#`). */
function topLevel(text: string): SyntaxNode[] {
  const nodes: SyntaxNode[] = [];
  for (let node = typstParser.parse(text).topNode.firstChild; node; node = node.nextSibling) nodes.push(node);
  return nodes;
}

function isDrafting(text: string, node: SyntaxNode): boolean {
  const str = node.getChild('Str');
  return str !== null && text.startsWith(`"${DRAFTING.slice(0, DRAFTING.lastIndexOf(':') + 1)}`, str.from);
}

function importsMarginNote(text: string, items: SyntaxNode): boolean {
  return items.getChildren('ImportItemPath').some((item) => text.slice(item.from, item.to) === MARGIN_NOTE);
}

/** Where pre-change `offset` ends up; inserts at `offset` itself go before it. */
function mapOffset(changes: readonly TextChange[], offset: number): number {
  let delta = 0;
  for (const change of changes) {
    if (change.from <= offset) delta += change.insert.length - (Math.min(change.to, offset) - change.from);
  }
  return offset + delta;
}
