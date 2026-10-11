// The command that adds a note, its key binding and the Source editor's "Comment". See comments in ../comments.ts.
import { Disposable } from '../../../core/disposable/disposable';
import type { SourceOffset, TypstDocument } from '../../../core/typst-document/typst-document';
import type { Commands } from '../../../hosts/commands/commands';
import { SOURCE_EDITOR } from '../../../hosts/source-editor/source-editor';
import { VISUAL_EDITOR } from '../../../hosts/visual-editor/visual-editor';
import type { TextEditor, WindowApi } from '../../../hosts/window/window';
import type { Workbench } from '../../../hosts/workbench/workbench';
import { calculateMarginNoteChanges } from '../model/add-margin-note';

/**
 * "Comment" in the frame: the command `comments.addComment` adds a note in the active editor, Ctrl/Cmd+Alt+M runs
 * it, and the tab bar (menu `editor/title`) offers it in the Source tab (the Visual editor has "Comment" in its own
 * toolbar).
 */
export function registerAddComment({ commands, window, workbench }: CommentContext, cards: NoteCards): Disposable {
  return Disposable.from(
    commands.registerCommand(ADD_COMMENT, () => {
      const editor = window.activeTextEditor;
      if (editor) addComment(editor, cards);
    }),
    commands.registerKeybinding('Mod+Alt+KeyM', ADD_COMMENT),
    workbench.registerMenuItem('editor/title', {
      command: ADD_COMMENT,
      title: 'Comment',
      icon: COMMENT_ICON,
      group: 'navigation',
      when: (context) => context.activeCustomEditorId === SOURCE_EDITOR,
    }),
  );
}

/** The command that adds a margin note at the selection of the editor the user works in. */
export const ADD_COMMENT = 'comments.addComment';

/** The notes' cards in the Visual editors: the notes gutter. */
export interface NoteCards {
  /** Focuses the card of the note whose source holds `offset` in `document`'s Visual editor; false if there is none. */
  editNote(document: TypstDocument, offset: SourceOffset): boolean;
}

/** What "Comment" uses of the extension API: where to register, and the editor the user works in. */
export interface CommentContext {
  readonly commands: Pick<Commands, 'registerCommand' | 'registerKeybinding'>;
  readonly window: Pick<WindowApi, 'activeTextEditor'>;
  readonly workbench: Pick<Workbench, 'registerMenuItem'>;
}

/**
 * Adds a `drafting` margin note at the editor's selection, in the document's own Typst (`#margin-note[selection][]`,
 * or `#margin-note[]` at a caret, plus the import), and puts the cursor into it: in the Visual tab the new note's card
 * opens, in the Source tab the caret goes between its `[]`. Nothing happens where no note fits.
 */
function addComment(editor: TextEditor, cards: NoteCards): void {
  const { document } = editor;
  const added = calculateMarginNoteChanges(document.text, editor.selection);
  if (!added) return;
  document.change(added.changes, ADD_COMMENT);
  if (editor.viewType !== VISUAL_EDITOR || !cards.editNote(document, added.note)) editor.revealRange({ from: added.note, to: added.note });
}

const COMMENT_ICON =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"/></svg>';
