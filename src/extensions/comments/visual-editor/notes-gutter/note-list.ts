// The margin notes of a document as a list, followed across edits. See NotesGutter in notes-gutter.ts.
import type { Mark as PMMark, Node as PMNode } from '@tiptap/pm/model';
import { NodeSelection, type Selection, type Transaction } from '@tiptap/pm/state';
import type { Mappable } from '@tiptap/pm/transform';
import type { SourceOffset } from '../../../../core/typst-document/typst-document';
import { rangeNoteSyntax } from '../../model/margin-note-syntax';
import { posToSource, serializeToTypst, sourceToPos } from '../../../../hosts/prosemirror-typst/prosemirror-typst';

/**
 * The margin notes of a Visual-editor document as a list, followed across
 * edits, and the transactions that change or remove one. Pure ProseMirror:
 * no DOM.
 */

/** The notes of `doc` in document order (an outer range note before the notes inside it). */
export function findNotes(doc: PMNode): DocNote[] {
  const notes: DocNote[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'marginNote') notes.push({ kind: 'point', from: pos, to: pos + 1, note: node.attrs.note, text: '' });
    if (!node.inlineContent) return true;
    for (const { mark, from, to } of noteSpans(node, pos + 1)) {
      notes.push({ kind: 'range', from, to, note: mark.attrs.note, text: doc.textBetween(from, to, ' ', ' '), mark });
    }
    return true;
  });
  return notes.sort((a, b) => a.from - b.from || b.to - a.to);
}

/** A margin note in the document: `from`..`to` is a point note's atom, or the highlighted text of a range note. */
export interface DocNote {
  kind: 'point' | 'range';
  from: number;
  to: number;
  /** The note's markup. */
  note: string;
  /** The highlighted text of a range note ('' for a point note). */
  text: string;
  /** A range note's `noteRange` mark. */
  mark?: PMMark;
}

/** A note with a key that stays the same while the note is edited and text around it changes. */
export interface KeyedNote extends DocNote {
  key: string;
}

/**
 * The notes `found` in a changed document, each with the key of the note in
 * `previous` (before the change) it continues: the one whose position
 * `mapping` takes to the found note's, preferably at both ends (a range note's
 * text may have changed at one end). Other notes get `newKey()`.
 */
export function followNotes(previous: readonly KeyedNote[], mapping: Pick<Mappable, 'map'>, found: readonly DocNote[], newKey: () => string): KeyedNote[] {
  const mapped = previous.map((note) => ({ note, from: mapping.map(note.from, 1), to: mapping.map(note.to, -1) }));
  const used = new Set<(typeof mapped)[number]>();
  const keys: (string | undefined)[] = found.map(() => undefined);
  for (const exact of [true, false]) {
    found.forEach((note, i) => {
      if (keys[i] !== undefined) return;
      const match = mapped.find((m) => !used.has(m) && m.note.kind === note.kind
        && (exact ? m.from === note.from && m.to === note.to : note.kind === 'range' && (m.from === note.from || m.to === note.to)));
      if (!match) return;
      used.add(match);
      keys[i] = match.note.key;
    });
  }
  return found.map((note, i) => ({ ...note, key: keys[i] ?? newKey() }));
}

/** Writes `markup` as the note of `note` (one step: the atom's or the mark's attribute). */
export function setNoteText(tr: Transaction, note: DocNote, markup: string): Transaction {
  if (note.kind === 'point') return tr.setNodeAttribute(note.from, 'note', markup);
  const mark = note.mark!;
  return tr.removeMark(note.from, note.to, mark).addMark(note.from, note.to, mark.type.create({ ...mark.attrs, note: markup }));
}

/** Removes `note`: a point note's call, or a range note's call around its text (the text stays). */
export function removeNote(tr: Transaction, note: DocNote): Transaction {
  return note.kind === 'point' ? tr.delete(note.from, note.to) : tr.removeMark(note.from, note.to, note.mark!);
}

/** The note the selection is in: a selected point note, or the innermost range note around the cursor (of equal ones, the inner: listed later). */
export function noteAtSelection<T extends DocNote>(notes: readonly T[], selection: Selection): T | undefined {
  if (selection instanceof NodeSelection) return notes.find((n) => n.kind === 'point' && n.from === selection.from);
  const { head } = selection;
  return notes
    .filter((n) => n.kind === 'range' && n.from <= head && head <= n.to)
    .reduce<T | undefined>((inner, n) => (!inner || n.to - n.from <= inner.to - inner.from ? n : inner), undefined);
}

/**
 * The note whose source holds `offset` (in the printed document): a point
 * note's call, or the `][note]` part of a range note.
 */
export function noteAtOffset<T extends DocNote>(notes: readonly T[], doc: PMNode, offset: SourceOffset): T | undefined {
  const found = noteAt(doc, offset);
  if (!found) return undefined;
  if (found.id === undefined) return notes.find((n) => n.kind === 'point' && n.from === found.pos);
  return notes.find((n) => n.kind === 'range' && n.to === found.pos && n.mark?.attrs.id === found.id);
}

/** The stretches of a textblock (content starting at `start`) covered by each range note. */
function noteSpans(block: PMNode, start: number): NoteSpan[] {
  const done: NoteSpan[] = [];
  let open: NoteSpan[] = [];
  block.forEach((child, offset) => {
    const pos = start + offset;
    const notes = child.marks.filter((m) => m.type.name === 'noteRange');
    done.push(...open.filter((span) => !span.mark.isInSet(notes)));
    open = open.filter((span) => span.mark.isInSet(notes));
    for (const mark of notes) if (!open.some((span) => span.mark.eq(mark))) open.push({ mark, from: pos, to: pos });
    for (const span of open) span.to = pos + child.nodeSize;
  });
  return [...done, ...open];
}

interface NoteSpan {
  mark: PMMark;
  from: number;
  to: number;
}

/** A point note at `pos`, or the range note `id` whose text ends at `pos`. */
function noteAt(doc: PMNode, offset: SourceOffset): { pos: number; id?: unknown } | null {
  // hidden syntax maps to the next visible position: the end of the range note's text, or a point note's atom
  const pos = sourceToPos(doc, offset);
  if (doc.nodeAt(pos)?.type.name === 'marginNote' && posToSource(doc, pos) <= offset) return { pos };
  const $pos = doc.resolve(pos);
  // notes ending at the same place are nested; the inner one, numbered later, closes first
  const ending = noteSpans($pos.parent, $pos.start()).filter((span) => span.to === pos).sort((a, b) => b.mark.attrs.id - a.mark.attrs.id);
  const source = serializeToTypst(doc);
  let cursor: number = posToSource(doc, pos, -1);
  for (const { mark } of ending) {
    const { close } = rangeNoteSyntax(mark.attrs.head, mark.attrs.note);
    const at = source.indexOf(close, cursor);
    if (at < 0 || offset < at) return null;
    if (offset < at + close.length) return { pos, id: mark.attrs.id };
    cursor = at + close.length;
  }
  return null;
}
