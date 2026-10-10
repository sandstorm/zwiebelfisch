import { HocuspocusProvider } from '@hocuspocus/provider';
import type { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import type { Comments } from '../comments/comments';
import type { Project } from '../editor/project';
import { RemoteCursors, type CollaborationUser, type HighlightTarget } from './remote-cursors';
import { SharedComments } from './shared-comments';
import { SharedProject } from './shared-project';

export type { CollaborationUser } from './remote-cursors';

/**
 * Where the shared state lives: a Y.Doc the host connects itself (any
 * provider; pass it synced, and its awareness for remote cursors), or a
 * Hocuspocus server the widget connects to.
 */
export type CollaborationOptions =
  | { doc: Y.Doc; awareness?: Awareness }
  | { url: string; room: string; token?: string };

/** What gets shared: the project's Typst files and the main file's review comments. */
export interface Shared {
  project: Project;
  comments: Comments;
  user?: CollaborationUser;
}

/**
 * Real-time collaboration for one widget: the Typst files' text and the
 * review comments through a Y.Doc (one per project), the users' cursors
 * through awareness. Only text is shared — the editing views never sync
 * directly; they keep following their TypstDocument.
 */
export class Collaboration {
  private readonly sharedProject: SharedProject;
  private readonly sharedComments: SharedComments;
  private readonly cursors: RemoteCursors | null;

  private constructor(
    ydoc: Y.Doc,
    awareness: Awareness | null,
    shared: Shared,
    private readonly provider: HocuspocusProvider | null,
  ) {
    const { project, comments, user } = shared;
    this.sharedProject = new SharedProject(project, ydoc);
    this.sharedComments = new SharedComments(comments, ydoc, () => this.sharedProject.text(project.main));
    const text = (path: string) => this.sharedProject.text(path);
    this.cursors = awareness ? new RemoteCursors(awareness, { user: user ?? { name: 'Anonymous' }, text }) : null;
  }

  /**
   * Starts sharing `shared`. With a server, this connects and waits for the
   * first sync, so a room's existing text wins over the local one.
   */
  static async start(options: CollaborationOptions, shared: Shared): Promise<Collaboration> {
    if ('doc' in options) return new Collaboration(options.doc, options.awareness ?? null, shared, null);
    const ydoc = new Y.Doc();
    const provider = new HocuspocusProvider({ url: options.url, name: options.room, token: options.token ?? null, document: ydoc });
    await new Promise<void>((resolve) => {
      if (provider.isSynced) resolve();
      else provider.on('synced', () => resolve());
    });
    return new Collaboration(ydoc, provider.awareness, shared, provider);
  }

  /** Shares the project's current set of files (call after replacing them through the API). */
  sync(): void {
    this.sharedProject.sync();
  }

  /** Tells the others where the local user's selection is (a source range in `path`), or nowhere. */
  setCursor(path: string | null, range?: { from: number; to: number }): void {
    this.cursors?.setLocal(path, range);
  }

  /** Draws the other users' cursors in `path` into `views` (the views of the shown file). */
  showCursors(path: string | null, views: readonly HighlightTarget[]): void {
    this.cursors?.show(path, views);
  }

  destroy(): void {
    this.cursors?.destroy();
    this.sharedComments.destroy();
    this.sharedProject.destroy();
    this.provider?.destroy();
    this.provider?.document.destroy();
  }
}
