// The margin notes of every Typst file in search everywhere. See comments in ../comments.ts.
import { ProjectPath } from '../../../core/paths/paths';
import type { Project } from '../../../core/project/project';
import { VISUAL_EDITOR } from '../../../hosts/visual-editor/visual-editor';
import type { SearchProvider, WindowApi } from '../../../hosts/window/window';
import { findNotes, type FoundNote } from '../model/find-notes';
import { firstWords } from '../model/note-thread';
import type { NoteCards } from './window';

/**
 * "Comments" (prefix `!`): the margin notes of every Typst file, by their first message, with who wrote in the thread
 * (matched too) and the file; picking one opens the file at the note and, in the Visual editor, its card. A file is read
 * again only when it changed.
 */
export function commentSearch({ project, window }: CommentSearchContext, cards: NoteCards): SearchProvider {
  let scans = new Map<ProjectPath, { text: string; notes: FoundNote[] }>();
  const open = (path: ProjectPath, { at }: FoundNote) => {
    window.showDocument(path, { selection: { from: at, to: at } });
    const editor = window.activeTextEditor;
    // only a Visual editor has cards; its reveal cannot tell itself apart from the user moving the caret
    if (editor?.viewType === VISUAL_EDITOR) cards.editNote(editor.document, at);
  };
  return {
    id: 'comments.notes',
    label: 'Comments',
    prefix: '!',
    order: 60,
    provideItems: () => {
      const next = new Map<ProjectPath, { text: string; notes: FoundNote[] }>();
      for (const path of project.paths().filter(ProjectPath.isTypst)) {
        const text = project.document(path)?.text ?? '';
        const known = scans.get(path);
        next.set(path, known?.text === text ? known : { text, notes: findNotes(text) });
      }
      scans = next;
      return [...next].flatMap(([path, { notes }]) =>
        notes.map((note) => ({
          label: firstWords(note.messages[0].text, MAX_LABEL),
          description: [authors(note), ProjectPath.displayName(path)].filter(Boolean).join(' · '),
          accept: () => open(path, note),
        })),
      );
    },
  };
}

export interface CommentSearchContext {
  readonly project: Pick<Project, 'paths' | 'document'>;
  readonly window: Pick<WindowApi, 'activeTextEditor' | 'showDocument'>;
}

/** Longer first messages are cut (at a word) in the list. */
const MAX_LABEL = 80;

/** Who wrote in the thread, each once, in order. */
function authors({ messages }: FoundNote): string {
  return [...new Set(messages.flatMap(({ author }) => author ?? []))].join(', ');
}
