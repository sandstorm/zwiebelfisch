// Files dropped into the Typst editors. See #extendEditors in ../workbench.ts.
import { Extension as TiptapExtension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { EditorSelection, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { ProjectPath } from '../../../core/paths/paths';
import { SourceOffset, type TypstDocument } from '../../../core/typst-document/typst-document';
import type { DocumentDropEdit } from '../../languages/languages';
import { posToSource, insertTypst } from '../../visual-editor/visual-editor';
import { PROJECT_PATH_TYPE } from '../workbench';

/** What the Typst editors do with dropped files: what a project file becomes, and how files from the computer get into the project. */
export interface DocumentDrops {
  /** What the project file `file` dropped at `offset` of `document` becomes (`languages.provideDocumentDropEdit`); null: nothing. */
  edit(document: TypstDocument, offset: SourceOffset, file: ProjectPath): DocumentDropEdit | null;
  /** Adds `files` from the computer, dropped into `document`, to the project; resolves to the project files they are, in order (none for a refused one). */
  upload(document: TypstDocument, files: File[]): Promise<ProjectPath[]>;
}

/**
 * Takes files dropped on a Visual editor: a project file (drag type `PROJECT_PATH_TYPE`, a row of the file panel), or
 * files from the computer, once uploaded. Inserts each one's edit (`insertTypst`: inline content into the text,
 * blocks after the block there), the first where they were dropped, the others after it, each with its other
 * changes in the same undo step. A file nobody makes something of inserts nothing. Other drops are left to the others.
 */
export function visualEditorDrops(document: TypstDocument, drops: DocumentDrops): TiptapExtension {
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
                const dropped = droppedFiles(event, document, drops);
                if (dropped === undefined) return false;
                let at: number | undefined = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? view.state.selection.to;
                const insert = (files: readonly ProjectPath[]) => {
                  for (const file of files) {
                    // an upload takes a while: the document may have shrunk since
                    const pos = Math.min(at ?? view.state.selection.to, view.state.doc.content.size);
                    const edit = drops.edit(document, posToSource(view.state.doc, pos), file);
                    if (!edit) continue;
                    insertTypst(editor, edit.insertText, at === undefined ? undefined : pos, edit.additionalEdit);
                    at = undefined; // the next one after it, at the cursor
                  }
                };
                if (Array.isArray(dropped)) insert(dropped);
                else void dropped.then(insert);
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
 * Takes files dropped on a Source editor (as `visualEditorDrops`): inserts their edits at the drop position, one
 * after the other, each with its other changes in the same transaction (one undo step); the cursor goes after the
 * inserted text.
 */
export function sourceEditorDrops(document: TypstDocument, drops: DocumentDrops): Extension {
  return EditorView.domEventHandlers({
    dragover: (event) => accept(event),
    drop: (event, view) => {
      const dropped = droppedFiles(event, document, drops);
      if (dropped === undefined) return false;
      let pos = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head;
      const insert = (files: readonly ProjectPath[]) => {
        for (const file of files) {
          // an upload takes a while: the document may have shrunk since
          pos = Math.min(pos, view.state.doc.length);
          const edit = drops.edit(document, SourceOffset.of(pos), file);
          if (!edit) continue;
          const changes = view.state.changes([{ from: pos, insert: edit.insertText }, ...(edit.additionalEdit ?? [])]);
          pos = changes.mapPos(pos, 1);
          view.dispatch({ changes, selection: EditorSelection.cursor(pos), userEvent: 'input.drop', scrollIntoView: true });
          view.focus();
        }
      };
      if (Array.isArray(dropped)) insert(dropped);
      else void dropped.then(insert);
      return true;
    },
  });
}

/** On dragover: lets a project file or files from the computer be dropped (the browser only drops what a dragover accepted). */
function accept(event: DragEvent): boolean {
  const types = event.dataTransfer?.types ?? [];
  if (!types.includes(PROJECT_PATH_TYPE) && !types.includes('Files')) return false;
  event.preventDefault();
  event.dataTransfer!.dropEffect = 'copy';
  return true;
}

/**
 * On drop: the project file dropped (none for an invalid path), or the files from the computer, once uploaded; the
 * event then taken (the browser, the editor's own drop handling and the widget's `onDidDropFiles` see it no more).
 * Undefined: neither, the event left alone.
 */
function droppedFiles(event: DragEvent, document: TypstDocument, drops: DocumentDrops): ProjectPath[] | Promise<ProjectPath[]> | undefined {
  const data = event.dataTransfer;
  if (data?.types.includes(PROJECT_PATH_TYPE)) {
    take(event);
    const file = ProjectPath.parse(data.getData(PROJECT_PATH_TYPE));
    return file ? [file] : [];
  }
  if (!data?.types.includes('Files') || data.files.length === 0) return undefined;
  take(event);
  return drops.upload(document, [...data.files]);
}

function take(event: DragEvent): void {
  event.preventDefault();
  event.stopPropagation();
}
