// The collaboration extension. Entry of extensions/collaboration/. See docs/10_guide/04_collaboration.typ.
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
 * Real-time collaboration (`options`: see `CollaborationOptions`) as the workbench's `user`: shares the project,
 * publishes the local selection, draws the others' places in every file's views and marks the files they are in; in
 * a GitLab-backed room, the user commits through the room's source control, and the browser asks before the last user
 * leaves changes the server does not commit by itself. Not a built-in: the host adds it with its
 * connection (`createTypstEditor({ extensions: (builtinExtensions) => [...builtinExtensions, collaboration({ url, room })] })`).
 *
 * Real-time editing of the project with others (Yjs).
 *
 * Why this entry is small and eager: the widget loads it with every other extension, but most widgets never
 * collaborate, so the Yjs side (model/model.ts: Collaboration, SharedProject, RemoteCursors, GitLabSourceControl, …) is
 * a chunk of its own that CollaborationLink loads on demand. Nothing here may import that chunk other than as a type.
 * The extension draws the other users' places itself, through the hosts' generic contribution points: CodeMirror
 * extensions in the Source editors (source-editor/; also what keeps other users' edits out of their undo history),
 * highlights, decorations and box code extensions in the Visual editors (visual-editor/), file decorations in the
 * workbench (workbench/). It reads them from its own `Presences`. Until the room's text is in the project, the editing
 * area shows "Connecting to the room…" and takes no input (window.withProgress). In a room backed by a GitLab branch it
 * registers the branch as a workbench source control, and has the browser warn before the last user leaves changes
 * nobody commits.
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
