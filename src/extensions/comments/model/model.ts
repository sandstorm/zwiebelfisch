// The comments model: margin notes as Typst text (drafting's call syntax, threads, the edits that add a note, the
// sources without notes) and where the notes gutter puts its cards. Pure: no DOM, no editor library.
// Entry of extensions/comments/model/. See ARCHITECTURE.md, "Comments = margin notes".
export { addMarginNote, NOTE_STYLE } from './add-margin-note';
export { layoutCards, type CardBox, type CardLayoutOptions } from './card-layout';
export { NOTE_HEAD, noteCallSyntax, printNoteCall, rangeNoteSyntax, safeNote } from './margin-note-syntax';
export { addReply, deleteMessage, editMessage, localDate, readThread, type NewMessage, type NoteMessage } from './note-thread';
export { withoutNotes } from './without-notes';
