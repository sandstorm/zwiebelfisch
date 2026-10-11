// The collaboration extension: real-time editing of the project with others (Yjs). Entry of
// extensions/collaboration/. See docs/10_guide/04_collaboration.typ.
// Why this entry is small and eager: the widget loads it with every other extension, but most widgets never
// collaborate, so the Yjs side (model/model.ts: Collaboration, SharedProject, RemoteCursors, GitLabSourceControl, …) is a
// chunk of its own that CollaborationLink loads on demand. Nothing here may import that chunk other than as a type.
// The extension draws the other users' places itself, through the hosts' generic contribution points: CodeMirror
// extensions in the Source views (source-view/; also what keeps other users' edits out of their undo history),
// highlights, decorations and box code extensions in the Visual views (visual-view/), file decorations in the
// workbench (workbench/). It reads them from its own `Presences`. In a room backed by a GitLab branch it registers the
// branch as a workbench source control, and has the browser warn before the last user leaves changes nobody commits.
import type { Awareness } from 'y-protocols/awareness';
import type * as Y from 'yjs';
import type { TypstExtension } from '../../hosts/workbench/workbench';
import css from './collaboration.css?inline';
import { CollaborationLink } from './collaboration-link';
import { Presences } from './presence/presence';
import { perUserUndo, sourcePresence } from './source-view/source-view';
import { visualPresence } from './visual-view/visual-view';
import { leaveWarning, presenceDecorations } from './workbench/workbench';

/**
 * Where the shared state lives: a Y.Doc the host connects itself (any
 * provider; pass it synced, and its awareness for remote cursors), or a
 * Hocuspocus server the widget connects to.
 */
export type CollaborationOptions =
  | { doc: Y.Doc; awareness?: Awareness }
  | { url: string; room: string; token?: string };

/**
 * Real-time collaboration (`options`: see `CollaborationOptions`) as the workbench's `user`: shares the project,
 * publishes the local selection, draws the others' places in every file's views and marks the files they are in; in
 * a GitLab-backed room, the user commits through the room's source control, and the browser asks before the last user
 * leaves changes the server does not commit by itself. Not a built-in: the host adds it with its
 * connection (`createTypstEditor({ extensions: (builtinExtensions) => [...builtinExtensions, collaboration({ url, room })] })`).
 */
export function collaboration(options: CollaborationOptions): TypstExtension {
  return {
    id: 'collaboration',
    activate({ project, window, scm, workbench, sourceView, visualView, subscriptions }) {
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
      visualPresence(presences, documents).activate({ visualView, subscriptions });
      subscriptions.push(
        presences,
        sourceView.registerCodeMirrorExtension(sourcePresence(presences)),
        sourceView.registerCodeMirrorExtension(perUserUndo),
        window.registerFileDecorationProvider(presenceDecorations(presences)),
        link,
        // fired from the editors' own updates, after their state has the new selection
        window.onDidChangeTextEditorSelection(() => link.selectionChanged()),
      );
      const view = workbench.ownerDocument.defaultView;
      if (view) subscriptions.push(leaveWarning(view, () => link.leavesChangesUncommitted()));
    },
  };
}
