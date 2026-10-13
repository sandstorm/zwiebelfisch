import { HocuspocusProvider } from '@hocuspocus/provider';
import type { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { Disposable } from '../../../core/disposable/disposable';
import { EventEmitter, type Event } from '../../../core/event-emitter/event-emitter';
import type { ProjectPath } from '../../../core/paths/paths';
import type { SourceRange } from '../../../core/typst-document/typst-document';
import type { CollaborationOptions } from '../collaboration';
import type { PlacedPresence } from '../presence/presence';
import type { Project } from '../../../core/project/project';
import { roomFilePath } from '../../../core/room-protocol/room-protocol';
import type { User } from '../../../core/user/user';
import { RemoteCursors } from './remote-cursors';
import { GitLabSourceControl, type StatelessChannel, type Tell } from './gitlab-source-control';
import { SharedAssets } from './shared-assets';
import { SharedMainFile } from './shared-main-file';
import { SharedProject } from './shared-project';

/**
 * The lazily loaded side of collaboration for one widget: one Y.Doc per project, from a Hocuspocus server or from the
 * host. No DOM, no editor library.
 *
 * SharedProject keeps a Y.Text per Typst file and binds each document to it (TextBinding). The editors never sync on
 * their own; they keep following their TypstDocument. SharedMainFile keeps everyone on the same main file. RemoteCursors
 * carries the users' places over awareness. In a room backed by a GitLab branch (the server put a `baseSha` into the
 * Y.Doc's `meta` map), SharedAssets shares the other files too, GitLabSourceControl commits to the branch, and the main
 * file stays each user's own. The widget reaches all this through CollaborationLink
 * (../collaboration-link.ts). See docs/30_configuration/03_collaboration-server.typ.
 */
export class Collaboration {
  private readonly sharedProject: SharedProject;
  private readonly cursors: RemoteCursors | null;
  private readonly assets: SharedAssets | null = null;
  private readonly mainFile: SharedMainFile | null = null;
  private readonly presenceChanged = new EventEmitter<readonly PlacedPresence[]>();
  /** Every other user's place, in any file, whenever one changes. */
  readonly onDidChangePresence: Event<readonly PlacedPresence[]> = this.presenceChanged.event;
  /** Commits to the branch, in a room backed by a GitLab branch (else null). */
  readonly sourceControl: GitLabSourceControl | null = null;

  private constructor(
    ydoc: Y.Doc,
    awareness: Awareness | null,
    shared: SharedRoom,
    private readonly server: { provider: HocuspocusProvider; files: (path: ProjectPath) => Promise<Uint8Array>; tell: Tell } | null,
  ) {
    const { project, user } = shared;
    if (server && GitLabSourceControl.isGitLabRoom(ydoc)) {
      this.sourceControl = new GitLabSourceControl(ydoc, statelessChannel(server.provider), server.tell, user && { name: user.name });
      this.assets = new SharedAssets(project, ydoc, server.files);
    }
    this.sharedProject = new SharedProject(project, ydoc);
    // after the files, so the room's main file is there to take
    if (!this.sourceControl && !project.mainLocked) this.mainFile = new SharedMainFile(project, ydoc);
    const text = (path: ProjectPath) => this.sharedProject.text(path);
    const onPresence = (presences: readonly PlacedPresence[]) => this.presenceChanged.fire(presences);
    this.cursors = awareness ? new RemoteCursors(awareness, { user: user ?? { name: 'Anonymous' }, text, onPresence }) : null;
  }

  /**
   * Starts sharing `shared`. With a server, this connects and waits for the
   * first sync, so a room's existing text wins over the local one; the room's source control tells its outcomes
   * and news with `tell` (default: not at all). Rejects with the server's reason when it refuses the room (a wrong
   * token, or a plain room on a server that opens only GitLab rooms).
   */
  static async start(options: CollaborationOptions, shared: SharedRoom, tell: Tell = () => {}): Promise<Collaboration> {
    if ('doc' in options) return new Collaboration(options.doc, options.awareness ?? null, shared, null);
    const ydoc = new Y.Doc();
    const provider = new HocuspocusProvider({ url: options.url, name: options.room, token: options.token ?? null, document: ydoc });
    try {
      await new Promise<void>((resolve, reject) => {
        provider.on('authenticationFailed', ({ reason }: { reason: string }) => reject(new Error(reason)));
        if (provider.isSynced) resolve();
        else provider.on('synced', () => resolve());
      });
    } catch (error) {
      provider.destroy();
      ydoc.destroy();
      throw error;
    }
    return new Collaboration(ydoc, provider.awareness, shared, { provider, files: roomFiles(options), tell });
  }

  /**
   * Whether leaving now would leave changes behind that nobody commits: the room's source control has changes the
   * server does not commit by itself (auto-commit off, or blocked by a conflict), and nobody else is in the room.
   */
  get leavesChangesUncommitted(): boolean {
    return !!this.sourceControl?.changesStayUncommitted && !this.cursors?.hasOthers;
  }

  /** Tells the others where the local user's selection is (a source range in `path`), or nowhere. */
  setCursor(path: ProjectPath | null, range?: SourceRange): void {
    this.cursors?.setLocal(path, range);
  }

  dispose(): void {
    this.presenceChanged.dispose();
    this.sourceControl?.dispose();
    this.cursors?.dispose();
    this.assets?.dispose();
    this.mainFile?.dispose();
    this.sharedProject.dispose();
    this.server?.provider.destroy();
    this.server?.provider.document.destroy();
  }
}

/** What gets shared: the project's Typst files (margin notes are part of their text). */
export interface SharedRoom {
  project: Project;
  user?: User;
}

function statelessChannel(provider: HocuspocusProvider): StatelessChannel {
  return {
    send: (payload: string) => provider.sendStateless(payload),
    onDidReceiveMessage(listener) {
      const handler = ({ payload }: { payload: string }) => listener(payload);
      provider.on('stateless', handler);
      return new Disposable(() => provider.off('stateless', handler));
    },
  };
}

/**
 * Fetches a file of the room from the server's HTTP side (same host and path
 * as the WebSocket: ws → http, wss → https), with the room's token.
 */
function roomFiles(options: { url: string; room: string; token?: string }): (path: ProjectPath) => Promise<Uint8Array> {
  const base = options.url.replace(/^ws/, 'http').replace(/\/$/, '');
  const headers: Record<string, string> = options.token ? { Authorization: `Bearer ${options.token}` } : {};
  return async (path) => {
    const response = await fetch(base + roomFilePath(options.room, path), { headers });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  };
}
