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
import { roomsWebSocketUrl, serverHttpBase, SignInRequired } from '../account';
import type { User } from '../../../core/user/user';
import { RemoteCursors } from './remote-cursors';
import { GitLabSourceControl, type StatelessChannel, type Tell } from './gitlab-source-control';
import { SharedAssets } from './shared-assets';
import { SharedMainFile } from './shared-main-file';
import { SharedProject } from './shared-project';

/**
 * The lazily loaded side of collaboration for one widget: one Y.Doc per project, from a Hocuspocus server or from the
 * host. No DOM, no editor library. It shares:
 * - each Typst file's text (SharedProject)
 * - the main file (SharedMainFile), except in a GitLab-backed room, where it stays each user's own
 * - the users' places (RemoteCursors)
 * - in a room backed by a GitLab branch, the other files (SharedAssets) and commits to the branch (GitLabSourceControl)
 *
 * Used through CollaborationLink in ../collaboration-link.ts.
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
  /** Settles when the server's connection ended because the session did (it no longer reconnects then). */
  readonly signedOut: Promise<void>;

  private constructor(
    ydoc: Y.Doc,
    awareness: Awareness | null,
    shared: SharedRoom,
    private readonly server: {
      provider: HocuspocusProvider;
      files: (path: ProjectPath) => Promise<Uint8Array>;
      tell: Tell;
      signedOut: Promise<void>;
    } | null,
  ) {
    const { project, user } = shared;
    this.signedOut = server?.signedOut ?? new Promise<void>(() => {});
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
   * and news with `tell` (default: not at all). The WebSocket carries the session cookie: the server knows who
   * connects, and refuses it without a session (401, which a browser does not tell; the connection just closes).
   * So `signedIn` is asked whenever it closes: false, and it stops reconnecting, `start` rejecting with
   * SignInRequired, or later `signedOut` settling. Rejects with the server's reason when it refuses the room (no
   * access to the GitLab project; a plain room on a server that opens only GitLab rooms).
   */
  static async start(
    options: CollaborationOptions,
    shared: SharedRoom,
    tell: Tell = () => {},
    signedIn: () => Promise<boolean> = async () => true,
  ): Promise<Collaboration> {
    if ('doc' in options) return new Collaboration(options.doc, options.awareness ?? null, shared, null);
    const ydoc = new Y.Doc();
    const provider = new HocuspocusProvider({ url: roomsWebSocketUrl(options.url), name: options.room, document: ydoc });
    const signedOut = whenSignedOut(provider, signedIn);
    try {
      await new Promise<void>((resolve, reject) => {
        provider.on('authenticationFailed', ({ reason }: { reason: string }) => reject(new Error(reason)));
        void signedOut.then(() => reject(new SignInRequired()));
        if (provider.isSynced) resolve();
        else provider.on('synced', () => resolve());
      });
    } catch (error) {
      provider.destroy();
      ydoc.destroy();
      throw error;
    }
    return new Collaboration(ydoc, provider.awareness, shared, { provider, files: roomFiles(options), tell, signedOut });
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

/** Settles once the connection closed and `signedIn` says the session is gone (not when the server cannot be asked); the provider stops reconnecting then. */
function whenSignedOut(provider: HocuspocusProvider, signedIn: () => Promise<boolean>): Promise<void> {
  return new Promise((resolve) => {
    const closed = () =>
      void signedIn()
        .catch(() => true)
        .then((still) => {
          if (still) return;
          provider.off('close', closed);
          provider.disconnect();
          resolve();
        });
    provider.on('close', closed);
  });
}

/** Fetches a file of the room from the server's HTTP side, with the session cookie (as the WebSocket). */
function roomFiles(options: { url: string; room: string }): (path: ProjectPath) => Promise<Uint8Array> {
  const base = serverHttpBase(options.url);
  return async (path) => {
    const response = await fetch(base + roomFilePath(options.room, path), { credentials: 'include' });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  };
}
