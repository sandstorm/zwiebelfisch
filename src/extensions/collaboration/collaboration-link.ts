// CollaborationLink: the widget's side of a Collaboration, which it loads on demand (so this file must stay outside
// the lazily loaded chunk, model/). See collaboration.ts.
import type { Collaboration, CollaborationOptions, GitLabSourceControl, Shared } from './model/model';
import type { ProjectPath } from '../../core/paths/paths';
import type { PlacedPresence } from './presence/presence';

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
  /** Called once connected, in a room backed by a GitLab branch: what commits to it. */
  onSourceControl?(sourceControl: GitLabSourceControl): void;
  /** The other users' places changed (every file; e.g. for the file panel). */
  onPresence?(presences: readonly PlacedPresence[]): void;
}

/**
 * The widget's side of collaboration. Loads the collaboration code (Yjs,
 * Hocuspocus) on demand, so widgets without collaboration never download it;
 * publishes the local selection when the views report a change (`selectionChanged`), and tells
 * the widget where everyone else is.
 */
export class CollaborationLink {
  private collaboration: Collaboration | null = null;
  private destroyed = false;
  private scheduled = false;

  constructor(
    options: CollaborationOptions,
    shared: Shared,
    private readonly widget: LinkedWidget,
  ) {
    void this.start(options, shared);
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
    if (collaboration.sourceControl) this.widget.onSourceControl?.(collaboration.sourceControl);
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
