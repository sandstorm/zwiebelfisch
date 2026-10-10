// The collaboration extension: real-time editing of the project with others (Yjs). Entry of
// extensions/collaboration/. See ARCHITECTURE.md, "Collaboration".
// Why this entry is small and eager: the widget loads it with every other extension, but most widgets never
// collaborate, so the Yjs side (model/: Collaboration, SharedProject, RemoteCursors, RoomVersions, …) is a chunk of
// its own that CollaborationLink loads on demand. Nothing here may import model/ other than as a type.
// The extension contributes the drawing of the other users' carets to both views (source-view/, visual-view/; the
// views only hand them over as PresenceTargets) and offers the session to other extensions as the `collaboration`
// service (the file panel shows where everyone is; versions saves a version of a GitLab-backed room).
import type { CollaborationOptions, CollaborationUser, RoomVersions } from './model/model';
import { Disposable } from '../../core/disposable/disposable';
import { EventEmitter, type Event } from '../../core/event-emitter/event-emitter';
import type { PlacedPresence } from '../../core/typst-document/typst-document';
import type { TypstExtension } from '../../hosts/workbench/workbench';
import css from './collaboration.css?inline';
import { CollaborationLink } from './collaboration-link';
import { presence as sourcePresence } from './source-view/source-view';
import { presence as visualPresence } from './visual-view/visual-view';

export type { CollaborationOptions } from './model/model';

declare module '../../hosts/workbench/workbench' {
  interface ServiceRegistry {
    /** The collaboration session (the collaboration extension, only with the `collaboration` option). */
    collaboration: CollaborationSession;
  }
}

/** What other extensions learn from the collaboration session (the `collaboration` service). */
export interface CollaborationSession {
  /** Where the other users are, in every file (e.g. for the file panel). */
  readonly onDidChangePresence: Event<readonly PlacedPresence[]>;
  /** Once connected to a room backed by a GitLab branch: its versions ("Save version"); at once for a late listener. */
  onDidConnectVersions(listener: (versions: RoomVersions) => void): Disposable;
}

/**
 * Real-time collaboration (`options`: see `CollaborationOptions`) as `user`: shares the project, publishes the
 * local selection, draws the others' carets in the shown file's views and provides the `collaboration` service.
 */
export function collaboration(options: CollaborationOptions, user?: CollaborationUser): TypstExtension {
  return {
    id: 'collaboration',
    activate({ project, workbench, sourceView, visualView, services, subscriptions }) {
      subscriptions.push(workbench.registerStyleSheet(css));
      const presence = new EventEmitter<readonly PlacedPresence[]>();
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
        onPresence: (presences) => presence.fire(presences),
      });
      const showCursors = () => {
        const editor = workbench.activeTextEditor;
        link.show((editor && project.pathOf(editor.document)) ?? null, editor ? [editor] : []);
      };
      visualPresence.activate({ visualView, subscriptions });
      subscriptions.push(
        sourceView.registerExtension(sourcePresence),
        new Disposable(() => link.destroy()),
        presence,
        connected,
        services.provide('collaboration', {
          onDidChangePresence: presence.event,
          onDidConnectVersions: (listener) => {
            if (versions) listener(versions);
            return connected.event(listener);
          },
        }),
        workbench.onDidShowFile(showCursors),
        // fired from the editors' own updates, after their state has the new selection
        workbench.onDidChangeTextEditorSelection(() => link.selectionChanged()),
      );
    },
  };
}
