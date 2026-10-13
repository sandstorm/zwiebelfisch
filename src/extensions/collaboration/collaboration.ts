import type { Awareness } from 'y-protocols/awareness';
import type * as Y from 'yjs';
import { ProgressLocation } from '../../hosts/window/window';
import type { TypstExtension } from '../../hosts/workbench/workbench';
import css from './collaboration.css?inline';
import { CollaborationLink } from './collaboration-link';
import { Presences } from './presence/presence';
import { perUserUndo, sourcePresence } from './source-editor/source-editor';
import { visualPresence } from './visual-editor/visual-editor';
import { leaveWarning, presenceDecorations } from './workbench/workbench';

/**
 * Real-time editing of the project with others, over Yjs, as the workbench's `user`. Not a built-in: the host adds it
 * with its connection (`extensions: (builtinExtensions) => [...builtinExtensions, collaboration({ url, room })]`).
 *
 * Most widgets never collaborate, so this entry stays small. The Yjs side (Collaboration in model/model.ts) is a chunk
 * of its own that CollaborationLink loads on demand; nothing outside model/ imports it other than as a type.
 * Sharing works on the documents, not the editors: each Typst file's text is bound to a Y.Text, and the editors keep
 * following their TypstDocument; outside GitLab rooms, the main file is the room's too. The other users' places come
 * back as `Presences`, which the extension draws itself through the hosts' generic contribution points: CodeMirror
 * extensions in the Source editors (source-editor/, which also keeps other users' edits out of the undo history),
 * highlights, decorations and raw box code in the Visual editors (visual-editor/), file decorations in the workbench
 * (workbench/).
 *
 * Until the room's text is in the project, the editing area shows "Connecting to the room…" and takes no input. In a
 * room backed by a GitLab branch, the branch is a source control, and the browser warns before the last user leaves
 * changes nobody commits. See docs/20_features/11_collaborative-editing.typ, docs/30_configuration/03_collaboration-server.typ and docs/40_architecture/13_server.typ.
 */
export function collaboration(options: CollaborationOptions): TypstExtension {
  return {
    id: 'collaboration',
    activate({ project, window, scm, workbench, sourceEditor, visualEditor, subscriptions }) {
      subscriptions.push(workbench.registerStyleSheet(css));
      const presences = new Presences((document) => project.pathOf(document));
      const user = workbench.user;
      const link = new CollaborationLink(options, { project, user }, {
        current: () => {
          const editor = window.activeTextEditor;
          const path = editor && project.pathOf(editor.document);
          return path ? { path, selection: editor.selection } : null;
        },
        focused: () => workbench.isEditorFocused(),
        onSourceControl: (sourceControl) => subscriptions.push(scm.registerSourceControl(sourceControl)),
        tell: (message, severity) => void { info: window.showInformationMessage, warning: window.showWarningMessage, error: window.showErrorMessage }[severity].call(window, message),
        onPresence: (all) => presences.set(all),
      });
      const documents = () => project.paths().flatMap((path) => project.document(path) ?? []);
      visualPresence(presences, documents).activate({ visualEditor, subscriptions });
      subscriptions.push(
        presences,
        sourceEditor.registerCodeMirrorExtension(sourcePresence(presences)),
        sourceEditor.registerCodeMirrorExtension(perUserUndo),
        window.registerFileDecorationProvider(presenceDecorations(presences)),
        link,
        // fired from the editors' own updates, after their state has the new selection
        window.onDidChangeTextEditorSelection(() => link.selectionChanged()),
      );
      // what is typed before the room's text is there would be replaced by it
      void window.withProgress({ location: ProgressLocation.EditingArea, title: 'Connecting to the room…' }, () => link.ready);
      const view = workbench.ownerDocument.defaultView;
      if (view) subscriptions.push(leaveWarning(view, () => link.leavesChangesUncommitted()));
    },
  };
}

/**
 * Where the shared state lives: a Y.Doc the host connects itself (any
 * provider; pass it synced, and its awareness for remote cursors), or a
 * Hocuspocus server the widget connects to.
 */
export type CollaborationOptions =
  | { doc: Y.Doc; awareness?: Awareness }
  | { url: string; room: string; token?: string };
