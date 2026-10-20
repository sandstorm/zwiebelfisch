// The margin notes of Typst source as threads, for search everywhere. See commentSearch in
// ../window/comment-search.ts.
import { typstParser } from 'codemirror-lang-typst/lezer';
import { SourceOffset } from '../../../core/typst-document/typst-document';
import { noteCallSyntax } from './margin-note-syntax';
import { readThread, type NoteMessage } from './note-thread';

/** Every margin note of `text` (as the Visual editor knows them) with at least one message, in source order. */
export function findNotes(text: string): FoundNote[] {
  const notes: FoundNote[] = [];
  typstParser.parse(text).iterate({
    enter: (node) => {
      const hash = node.node.prevSibling;
      if (node.name !== 'FuncCall' || hash?.name !== 'Hash' || hash.to !== node.from) return;
      const note = noteCallSyntax(text, node.node);
      const messages = note ? readThread(note.note) : [];
      // the note's markup ends right before the call's last `]`
      if (note && messages.length > 0) notes.push({ messages, at: SourceOffset.of(node.to - 1 - note.note.length) });
    },
  });
  return notes;
}

/** A margin note: its messages (oldest first) and where its note part starts (inside the last `[`). */
export interface FoundNote {
  readonly messages: readonly NoteMessage[];
  readonly at: SourceOffset;
}
