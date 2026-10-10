import type { Collaboration, CollaborationOptions, RoomVersions, Shared } from '../collab/collaboration';
import type { HighlightTarget } from '../collab/remote-cursors';

/** The editing view the local user works in, and what it has selected. */
export interface CurrentSelection {
  path: string;
  view: { selection(): { from: number; to: number } };
}

/** What the link asks of the widget, and tells it. */
export interface LinkedWidget {
  /** Where the local user's selection is (null: not in a Typst file). */
  current(): CurrentSelection | null;
  /** Called once connected, in a room backed by a GitLab branch ("Save version", the files' base). */
  onVersions?(versions: RoomVersions): void;
}

/**
 * The widget's side of collaboration. Loads the collaboration code (Yjs,
 * Hocuspocus) on demand, so widgets without collaboration never download it;
 * publishes the local selection whenever it changes inside `area`; draws the
 * others' cursors into the views of the file shown.
 */
export class CollaborationLink {
  private collaboration: Collaboration | null = null;
  private shown: { path: string | null; views: readonly HighlightTarget[] } = { path: null, views: [] };
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
  show(path: string | null, views: readonly HighlightTarget[]): void {
    this.shown = { path, views };
    this.collaboration?.showCursors(path, views);
  }

  /** Shares the project's current set of files (after they were replaced through the API). */
  sync(): void {
    this.collaboration?.sync();
  }

  destroy(): void {
    this.destroyed = true;
    this.area.ownerDocument.removeEventListener('selectionchange', this.schedule);
    this.collaboration?.destroy();
  }

  private async start(options: CollaborationOptions, shared: Shared): Promise<void> {
    const { Collaboration } = await import('../collab/collaboration');
    const collaboration = await Collaboration.start(options, shared);
    if (this.destroyed) {
      collaboration.destroy();
      return;
    }
    this.collaboration = collaboration;
    collaboration.showCursors(this.shown.path, this.shown.views);
    if (collaboration.versions) this.widget.onVersions?.(collaboration.versions);
    this.area.ownerDocument.addEventListener('selectionchange', this.schedule);
  }

  /** Publishes the selection once per burst of selection events, when the user works in this widget. */
  private readonly schedule = (): void => {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      if (!this.collaboration || !this.focused()) return;
      const current = this.widget.current();
      this.collaboration.setCursor(current?.path ?? null, current?.view.selection());
    });
  };

  private focused(): boolean {
    const root = this.area.getRootNode() as Document | ShadowRoot;
    return root.activeElement !== null && this.area.contains(root.activeElement);
  }
}
