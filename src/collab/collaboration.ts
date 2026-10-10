import { HocuspocusProvider } from '@hocuspocus/provider';
import type { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import type { PlacedPresence, PresenceTarget } from '../document/presence';
import type { Project } from '../editor/project';
import { roomFilePath } from './gitlab-protocol';
import { RemoteCursors, type CollaborationUser } from './remote-cursors';
import { RoomVersions } from './room-versions';
import { SharedAssets } from './shared-assets';
import { SharedProject } from './shared-project';

export type { CollaborationUser } from './remote-cursors';
export type { RoomVersions } from './room-versions';

/**
 * Where the shared state lives: a Y.Doc the host connects itself (any
 * provider; pass it synced, and its awareness for remote cursors), or a
 * Hocuspocus server the widget connects to.
 */
export type CollaborationOptions =
  | { doc: Y.Doc; awareness?: Awareness }
  | { url: string; room: string; token?: string };

/** What gets shared: the project's Typst files (margin notes are part of their text). */
export interface Shared {
  project: Project;
  user?: CollaborationUser;
}

/**
 * Real-time collaboration for one widget: the Typst files' text through a
 * Y.Doc (one per project), the users' cursors
 * through awareness. Only text is shared — the editing views never sync
 * directly; they keep following their TypstDocument. In a room backed by a
 * GitLab branch (the server put a base into its `meta` map) the other files
 * are shared too, and `versions` offers "Save version".
 */
export class Collaboration {
  private readonly sharedProject: SharedProject;
  private readonly cursors: RemoteCursors | null;
  private readonly assets: SharedAssets | null = null;
  private presenceListener: ((presences: readonly PlacedPresence[]) => void) | null = null;
  /** "Save version" and the files' base, in a room backed by a GitLab branch (else null). */
  readonly versions: RoomVersions | null = null;

  private constructor(
    ydoc: Y.Doc,
    awareness: Awareness | null,
    shared: Shared,
    private readonly server: { provider: HocuspocusProvider; files: (path: string) => Promise<Uint8Array> } | null,
  ) {
    const { project, user } = shared;
    if (server && RoomVersions.isVersioned(ydoc)) {
      this.versions = new RoomVersions(ydoc, statelessChannel(server.provider));
      this.assets = new SharedAssets(project, ydoc, server.files);
    }
    this.sharedProject = new SharedProject(project, ydoc);
    const text = (path: string) => this.sharedProject.text(path);
    const onPresence = (presences: readonly PlacedPresence[]) => this.presenceListener?.(presences);
    this.cursors = awareness ? new RemoteCursors(awareness, { user: user ?? { name: 'Anonymous' }, text, onPresence }) : null;
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
    return new Collaboration(ydoc, provider.awareness, shared, { provider, files: roomFiles(options) });
  }

  /** Shares the project's current set of files (call after replacing them through the API). */
  sync(): void {
    this.sharedProject.sync();
  }

  /** Tells the others where the local user's selection is (a source range in `path`), or nowhere. */
  setCursor(path: string | null, range?: { from: number; to: number }): void {
    this.cursors?.setLocal(path, range);
  }

  /** Shows the other users' carets and selections in `path` in `views` (the views of the shown file). */
  showCursors(path: string | null, views: readonly PresenceTarget[]): void {
    this.cursors?.show(path, views);
  }

  /** Calls `listener` with every other user's place, in any file, whenever one changes (replaces the previous listener). */
  onPresence(listener: (presences: readonly PlacedPresence[]) => void): void {
    this.presenceListener = listener;
  }

  destroy(): void {
    this.cursors?.destroy();
    this.assets?.destroy();
    this.sharedProject.destroy();
    this.server?.provider.destroy();
    this.server?.provider.document.destroy();
  }
}

function statelessChannel(provider: HocuspocusProvider) {
  return {
    send: (payload: string) => provider.sendStateless(payload),
    listen(listener: (payload: string) => void) {
      const handler = ({ payload }: { payload: string }) => listener(payload);
      provider.on('stateless', handler);
      return () => void provider.off('stateless', handler);
    },
  };
}

/**
 * Fetches a file of the room from the server's HTTP side (same host and path
 * as the WebSocket: ws → http, wss → https), with the room's token.
 */
function roomFiles(options: { url: string; room: string; token?: string }): (path: string) => Promise<Uint8Array> {
  const base = options.url.replace(/^ws/, 'http').replace(/\/$/, '');
  const headers: Record<string, string> = options.token ? { Authorization: `Bearer ${options.token}` } : {};
  return async (path) => {
    const response = await fetch(base + roomFilePath(options.room, path), { headers });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  };
}
