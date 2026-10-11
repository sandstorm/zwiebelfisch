// Project files dropped into the Typst editors. See #extendEditors in ../workbench.ts.
import { Extension as TiptapExtension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { EditorSelection, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { ProjectPath } from '../../../core/paths/paths';
import { SourceOffset, type TypstDocument } from '../../../core/typst-document/typst-document';
import type { DocumentDropEdit } from '../../languages/languages';
import { posToSource } from '../../prosemirror-typst/prosemirror-typst';
import { insertTypst } from '../../visual-editor/visual-editor';
import { PROJECT_PATH_TYPE } from '../workbench';

/** What a project file dropped at `offset` of `document` becomes (`languages.provideDocumentDropEdit`); null: nothing. */
export type DropEdits = (document: TypstDocument, offset: SourceOffset, file: ProjectPath) => DocumentDropEdit | null;

/**
 * Takes a project file (drag type `PROJECT_PATH_TYPE`, a row of the file panel) dropped on a Visual editor: inserts its
 * edit where it was dropped (`insertTypst`: inline content into the text, blocks after the block there), with the
 * edit's other changes in the same undo step. A file nobody makes something of inserts nothing. Other drops are left
 * to the others.
 */
export function visualEditorDrops(document: TypstDocument, edits: DropEdits): TiptapExtension {
  return TiptapExtension.create({
    name: 'typstDocumentDrops',
    addProseMirrorPlugins() {
      const editor = this.editor;
      return [
        new Plugin({
          key: new PluginKey('typstDocumentDrops'),
          props: {
            handleDOMEvents: {
              dragover: (_view, event) => accept(event),
              drop: (view, event) => {
                const file = droppedFile(event);
                if (file === undefined) return false;
                const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? view.state.selection.to;
                const edit = file && edits(document, posToSource(view.state.doc, pos), file);
                if (edit) insertTypst(editor, edit.insertText, pos, edit.additionalEdit);
                return true;
              },
            },
          },
        }),
      ];
    },
  });
}

/**
 * Takes a project file dropped on a Source editor: inserts its edit at the drop position, its other changes in the
 * same transaction (one undo step); the cursor goes after the inserted text.
 */
export function sourceEditorDrops(document: TypstDocument, edits: DropEdits): Extension {
  return EditorView.domEventHandlers({
    dragover: (event) => accept(event),
    drop: (event, view) => {
      const file = droppedFile(event);
      if (file === undefined) return false;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head;
      const edit = file && edits(document, SourceOffset.of(pos), file);
      if (!edit) return true;
      const changes = view.state.changes([{ from: pos, insert: edit.insertText }, ...(edit.additionalEdit ?? [])]);
      view.dispatch({ changes, selection: EditorSelection.cursor(changes.mapPos(pos, 1)), userEvent: 'input.drop', scrollIntoView: true });
      view.focus();
      return true;
    },
  });
}

/** On dragover: lets a project file be dropped (the browser only drops what a dragover accepted; the data itself is readable on drop only). */
function accept(event: DragEvent): boolean {
  if (!event.dataTransfer?.types.includes(PROJECT_PATH_TYPE)) return false;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
  return true;
}

/**
 * On drop: the project file dropped (null: an invalid path), the event then taken (the browser and the editor's own
 * drop handling see it no more); undefined: no project file, the event left alone.
 */
function droppedFile(event: DragEvent): ProjectPath | null | undefined {
  if (!event.dataTransfer?.types.includes(PROJECT_PATH_TYPE)) return undefined;
  event.preventDefault();
  event.stopPropagation();
  return ProjectPath.parse(event.dataTransfer.getData(PROJECT_PATH_TYPE));
}
