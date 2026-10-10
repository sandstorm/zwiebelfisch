// CollaborationLink: connects the widget to a Collaboration (loaded on demand). See typst-editor.ts.
import type { Collaboration, CollaborationOptions, RoomVersions, Shared } from '../features/collaboration/collaboration';
import type { ProjectPath } from '../core/paths/paths';
import type { PlacedPresence, PresenceTarget } from '../core/typst-document/typst-document';

/** The editing view the local user works in, and what it has selected. */
export interface CurrentSelection {
  path: ProjectPath;
  view: { selection(): { from: number; to: number } };
}

/** What the link asks of the widget, and tells it. */
export interface LinkedWidget {
  /** Where the local user's selection is (null: not in a Typst file). */
  current(): CurrentSelection | null;
  /** Called once connected, in a room backed by a GitLab branch ("Save version", the files' base). */
  onVersions?(versions: RoomVersions): void;
  /** The project has the room's text now (first sync done), e.g. to start "changes since opened" from it. */
  onSynced?(): void;
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
    private readonly area: HTMLElement,
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
    const { Collaboration } = await import('../features/collaboration/collaboration');
    const collaboration = await Collaboration.start(options, shared);
    if (this.destroyed) {
      collaboration.destroy();
      return;
    }
    this.collaboration = collaboration;
    collaboration.onPresence((presences) => this.widget.onPresence?.(presences));
    collaboration.showCursors(this.shown.path, this.shown.views);
    this.widget.onSynced?.();
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
      if (!this.collaboration || !this.focused()) return;
      const current = this.widget.current();
      this.collaboration.setCursor(current?.path ?? null, current?.view.selection());
    });
  }

  private focused(): boolean {
    const root = this.area.getRootNode() as Document | ShadowRoot;
    return root.activeElement !== null && this.area.contains(root.activeElement);
  }
}
