import { SQLite } from '@hocuspocus/extension-sqlite';
import { Server, type Configuration, type Extension } from '@hocuspocus/server';
import { sharedToken, type Authenticate } from './auth.ts';
import { GitLabExtension, type GitLabOptions } from './gitlab/gitlab-extension.ts';

/**
 * The collaboration server as a WebSocket server on `port` (not listening yet: call `listen()`).
 *
 * People who edit one project together need its Y.Doc in one place. The server keeps one Y.Doc per room (= project):
 * it relays changes between the clients, asks `authenticate` who may open a room, and stores every room (SQLite by
 * default, or any Hocuspocus storage extension). It does not look inside a room, except when the room is backed by a
 * GitLab branch (`gitlab`, see GitLabExtension). The widget's side is the collaboration extension; both agree on
 * src/core/room-protocol. See docs/30_architecture/09_server.typ.
 */
export function createCollabServer(options: CollabOptions & { port: number; address?: string }): Server {
  return new Server({ ...collabConfiguration(options), port: options.port, address: options.address ?? '127.0.0.1' });
}

export interface CollabOptions {
  /**
   * Where rooms are loaded from and stored to: a Hocuspocus extension with
   * `onLoadDocument` / `onStoreDocument` (e.g. `@hocuspocus/extension-database`
   * with `fetch` / `store`). It keeps every room's Yjs state, GitLab rooms
   * included (their repository state is part of it). Default: SQLite at `database`.
   */
  storage?: Extension;
  /** The SQLite file of the default storage (default `:memory:`, which keeps nothing). */
  database?: string;
  /** Who may open a room (default: `sharedToken(undefined)`, everyone). */
  authenticate?: Authenticate;
  /** Milliseconds of quiet before a changed room is stored (Hocuspocus default 2000). */
  debounce?: number;
  /** Suppress the start screen and logs. */
  quiet?: boolean;
  /** GitLab-backed rooms (`gitlab:<project>@<branch>`, see gitlab/gitlab-extension.ts); unset: none. */
  gitlab?: GitLabOptions;
  /** Further extensions after the built-in ones (e.g. the playground's dev endpoints). */
  extensions?: Extension[];
}

/**
 * The Hocuspocus configuration of the collaboration server: `createCollabServer` without the WebSocket, as tests
 * run it in-process. Extensions in order: storage, GitLab rooms, `extensions`.
 */
export function collabConfiguration(options: CollabOptions = {}): Partial<Configuration> {
  const authenticate = options.authenticate ?? sharedToken(undefined);
  return {
    name: 'typst-editor',
    quiet: options.quiet ?? false,
    ...(options.debounce === undefined ? {} : { debounce: options.debounce }),
    extensions: [
      options.storage ?? new SQLite({ database: options.database ?? ':memory:' }),
      ...(options.gitlab ? [new GitLabExtension(options.gitlab, authenticate)] : []),
      ...(options.extensions ?? []),
    ],
    async onAuthenticate({ token, documentName }) {
      return { user: await authenticate(token, documentName) };
    },
  };
}
