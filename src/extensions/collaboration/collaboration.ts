// The collaboration extension and CollaborationLink: connects the widget to a Collaboration (loaded on demand, so
// this file must stay outside the lazily loaded chunk). See ARCHITECTURE.md, "Collaboration".
import type { Collaboration, CollaborationOptions, CollaborationUser, RoomVersions, Shared } from './model/model';
import { Disposable } from '../../core/disposable/disposable';
import { EventEmitter, type Event } from '../../core/event-emitter/event-emitter';
import type { ProjectPath } from '../../core/paths/paths';
import type { PlacedPresence, PresenceTarget } from '../../core/typst-document/typst-document';
import { presence as sourcePresence } from '../../hosts/source-view/source-view';
import type { TypstExtension } from '../../hosts/workbench/workbench';

export type { CollaborationOptions } from './model/model';

declare module '../../hosts/workbench/workbench' {
  interface ServiceRegistry {
    /** The collaboration session (the collaboration extension, only with the `collaboration` option). */
    collaboration: CollaborationSession;
  }
}

/** What other extensions learn from the collaboration session. */
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
    activate({ project, workbench, sourceView, services, subscriptions }) {
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

/** The editing view the local user works in, and what it has selected. */
export interface CurrentSelection {
  path: ProjectPath;
  view: { selection(): { from: number; to: number } };
}

/** What the link asks of the widget, and tells it. */
export interface LinkedWidget {
  /** Where the local user's selection is (null: not in a Typst file). */
  current(): CurrentSelection | null;
  /** Whether the user works in the widget's editing area (only then is the selection published). */
  focused(): boolean;
  /** Called once connected, in a room backed by a GitLab branch ("Save version"). */
  onVersions?(versions: RoomVersions): void;
  /** The other users' places changed (every file; e.g. for the file panel). */
  onPresence?(presences: readonly PlacedPresence[]): void;
}

/**
 * The widget's side of collaboration. Loads the collaboration code (Yjs,
 * Hocuspocus) on demand, so widgets without collaboration never download it;
 * publishes the local selection when the views report a change (`selectionChanged`); shows the
 * others' carets and selections in the views of the file shown, and tells
 * the widget where everyone is.
 */
export class CollaborationLink {
  private collaboration: Collaboration | null = null;
  private shown: { path: ProjectPath | null; views: readonly PresenceTarget[] } = { path: null, views: [] };
  private destroyed = false;
  private scheduled = false;

  constructor(
    options: CollaborationOptions,
    shared: Shared,
    private readonly widget: LinkedWidget,
  ) {
    void this.start(options, shared);
  }

  /** The file shown in the editing area changed: draw the cursors there (`views` of a Typst file, or none). */
  show(path: ProjectPath | null, views: readonly PresenceTarget[]): void {
    this.shown = { path, views };
    this.collaboration?.showCursors(path, views);
  }

  destroy(): void {
    this.destroyed = true;
    this.collaboration?.destroy();
  }

  private async start(options: CollaborationOptions, shared: Shared): Promise<void> {
    const { Collaboration } = await import('./model/model');
    const collaboration = await Collaboration.start(options, shared);
    if (this.destroyed) {
      collaboration.destroy();
      return;
    }
    this.collaboration = collaboration;
    collaboration.onPresence((presences) => this.widget.onPresence?.(presences));
    collaboration.showCursors(this.shown.path, this.shown.views);
    if (collaboration.versions) this.widget.onVersions?.(collaboration.versions);
  }

  /**
   * The local selection moved (called by the editing views after their state
   * has the new selection). Publishes it once per burst, when the user works
   * in this widget.
   */
  selectionChanged(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      if (!this.collaboration || !this.widget.focused()) return;
      const current = this.widget.current();
      this.collaboration.setCursor(current?.path ?? null, current?.view.selection());
    });
  }
}
