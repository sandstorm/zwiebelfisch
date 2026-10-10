// The collaboration extension: real-time editing of the project with others (Yjs). Entry of
// extensions/collaboration/. See ARCHITECTURE.md, "Collaboration".
// Why this entry is small and eager: the widget loads it with every other extension, but most widgets never
// collaborate, so the Yjs side (model/model.ts: Collaboration, SharedProject, RemoteCursors, RoomVersions, …) is a
// chunk of its own that CollaborationLink loads on demand. Nothing here may import that chunk other than as a type.
// The extension draws the other users' places itself, through the hosts' generic contribution points: CodeMirror
// extensions in the Source views (source-view/), highlights, decorations and box code extensions in the Visual views
// (visual-view/), file decorations in the workbench (workbench/). It reads them from its own `Presences`.
import type { CollaborationOptions, CollaborationUser, RoomVersions } from './model/model';
import { Disposable } from '../../core/disposable/disposable';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import type { TypstExtension } from '../../hosts/workbench/workbench';
import css from './collaboration.css?inline';
import { CollaborationLink } from './collaboration-link';
import { Presences } from './presence/presence';
import { sourcePresence } from './source-view/source-view';
import { visualPresence } from './visual-view/visual-view';
import { presenceDecorations } from './workbench/workbench';

export type { CollaborationOptions } from './model/model';

declare module '../../hosts/workbench/workbench' {
  interface ServiceRegistry {
    /** The collaboration session (the collaboration extension, only with the `collaboration` option). */
    collaboration: CollaborationSession;
  }
}

/** What other extensions learn from the collaboration session (the `collaboration` service). */
export interface CollaborationSession {
  /** Once connected to a room backed by a GitLab branch: its versions ("Save version"); at once for a late listener. */
  onDidConnectVersions(listener: (versions: RoomVersions) => void): Disposable;
}

/**
 * Real-time collaboration (`options`: see `CollaborationOptions`) as `user`: shares the project, publishes the
 * local selection, draws the others' places in every file's views and marks the files they are in.
 */
export function collaboration(options: CollaborationOptions, user?: CollaborationUser): TypstExtension {
  return {
    id: 'collaboration',
    activate({ project, workbench, sourceView, visualView, services, subscriptions }) {
      subscriptions.push(workbench.registerStyleSheet(css));
      const presences = new Presences((document) => project.pathOf(document));
      const connected = new EventEmitter<RoomVersions>();
      let versions: RoomVersions | null = null;
      const link = new CollaborationLink(options, { project, user }, {
        current: () => {
          const editor = workbench.activeTextEditor;
          const path = editor && project.pathOf(editor.document);
          return path ? { path, view: { selection: () => editor.selection } } : null;
        },
        focused: () => workbench.isEditorFocused(),
        onVersions: (opened) => {
          versions = opened;
          connected.fire(opened);
        },
        onPresence: (all) => presences.set(all),
      });
      const documents = () => project.paths().flatMap((path) => project.document(path) ?? []);
      visualPresence(presences, documents).activate({ visualView, subscriptions });
      subscriptions.push(
        presences,
        sourceView.registerExtension(sourcePresence(presences)),
        workbench.registerFileDecorationProvider(presenceDecorations(presences)),
        new Disposable(() => link.destroy()),
        connected,
        services.provide('collaboration', {
          onDidConnectVersions: (listener) => {
            if (versions) listener(versions);
            return connected.event(listener);
          },
        }),
        // fired from the editors' own updates, after their state has the new selection
        workbench.onDidChangeTextEditorSelection(() => link.selectionChanged()),
      );
    },
  };
}
