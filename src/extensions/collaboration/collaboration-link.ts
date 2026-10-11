// CollaborationLink. See collaboration.ts.
import type { CollaborationOptions } from './collaboration';
import type { Collaboration, SharedRoom } from './model/model';
import type { GitLabSourceControl, Tell } from './model/gitlab-source-control';
import type { ProjectPath } from '../../core/paths/paths';
import type { SourceRange } from '../../core/typst-document/typst-document';
import type { PlacedPresence } from './presence/presence';

/**
 * The widget's side of collaboration. Loads the collaboration code (Yjs,
 * Hocuspocus) on demand, so widgets without collaboration never download it;
 * publishes the local selection when the editors report a change (`selectionChanged`), and tells
 * the widget where everyone else is.
 *
 * The widget's side of a Collaboration, which it loads on demand (so this file must stay outside the lazily loaded
 * chunk, model/).
 */
export class CollaborationLink {
  private collaboration: Collaboration | null = null;
  private disposed = false;
  private scheduled = false;
  /**
   * Settles once the project is shared: the collaboration code loaded and, with a server, the room synced (its text
   * is in the project), or once that failed (logged). Until then, what the editors show may still be replaced.
   */
  readonly ready: Promise<void>;

  constructor(
    options: CollaborationOptions,
    shared: SharedRoom,
    private readonly widget: LinkedWidget,
  ) {
    this.ready = this.start(options, shared).catch((error: unknown) => console.error('collaboration could not start:', error));
  }

  dispose(): void {
    this.disposed = true;
    this.collaboration?.dispose();
  }

  private async start(options: CollaborationOptions, shared: SharedRoom): Promise<void> {
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

  /** Whether leaving now would leave changes behind that nobody commits (see `Collaboration.leavesChangesUncommitted`). */
  leavesChangesUncommitted(): boolean {
    return this.collaboration?.leavesChangesUncommitted ?? false;
  }

  /**
   * The local selection moved (called by the editors after their state
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

/** The file the local user works in, and what they have selected there. */
export interface CurrentSelection {
  path: ProjectPath;
  selection: SourceRange;
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
