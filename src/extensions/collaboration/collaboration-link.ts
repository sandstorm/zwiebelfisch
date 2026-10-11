// CollaborationLink: the widget's side of a Collaboration, which it loads on demand (so this file must stay outside
// the lazily loaded chunk, model/). See collaboration.ts.
import type { CollaborationOptions } from './collaboration';
import type { Collaboration, Shared } from './model/model';
import type { GitLabSourceControl, Tell } from './model/gitlab-source-control';
import type { ProjectPath } from '../../core/paths/paths';
import type { PlacedPresence } from './presence/presence';

/** The file the local user works in, and what they have selected there (source offsets). */
export interface CurrentSelection {
  path: ProjectPath;
  selection: { from: number; to: number };
}

/** What the link asks of the widget, and tells it. */
export interface LinkedWidget {
  /** Where the local user's selection is (null: not in a Typst file). */
  current(): CurrentSelection | null;
  /** Whether the user works in the widget's editing area (only then is the selection published). */
  focused(): boolean;
  /** Called once connected, in a room backed by a GitLab branch: what commits to it. */
  onSourceControl?(sourceControl: GitLabSourceControl): void;
  /** Tells the user what the room's source control has to say (its outcomes and news). */
  tell?: Tell;
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
  private disposed = false;
  private scheduled = false;

  constructor(
    options: CollaborationOptions,
    shared: Shared,
    private readonly widget: LinkedWidget,
  ) {
    void this.start(options, shared);
  }

  dispose(): void {
    this.disposed = true;
    this.collaboration?.dispose();
  }

  private async start(options: CollaborationOptions, shared: Shared): Promise<void> {
    const { Collaboration } = await import('./model/model');
    const collaboration = await Collaboration.start(options, shared, this.widget.tell);
    if (this.disposed) {
      collaboration.dispose();
      return;
    }
    this.collaboration = collaboration;
    collaboration.onDidChangePresence((presences) => this.widget.onPresence?.(presences));
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
      this.collaboration.setCursor(current?.path ?? null, current?.selection);
    });
  }
}
