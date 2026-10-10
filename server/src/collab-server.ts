import { SQLite } from '@hocuspocus/extension-sqlite';
import { Server, type Configuration, type Extension } from '@hocuspocus/server';
import { sharedToken, type Authenticate } from './auth.ts';

export interface CollabOptions {
  /**
   * Where rooms are loaded from and stored to: a Hocuspocus extension with
   * `onLoadDocument` / `onStoreDocument` (e.g. `@hocuspocus/extension-database`
   * with `fetch` / `store`). This is the extension point for GitLab
   * persistence. Default: SQLite at `database`.
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
}

/**
 * The Hocuspocus configuration of the collaboration server: one Y.Doc per
 * room (= project), as the widget's `collaboration` option shares it
 * (`files`: path → Y.Text, `comments`: thread id → Y.Map). The server does
 * not look inside; it relays, authenticates and persists.
 */
export function collabConfiguration(options: CollabOptions = {}): Partial<Configuration> {
  const authenticate = options.authenticate ?? sharedToken(undefined);
  return {
    name: 'typst-editor',
    quiet: options.quiet ?? false,
    ...(options.debounce === undefined ? {} : { debounce: options.debounce }),
    extensions: [options.storage ?? new SQLite({ database: options.database ?? ':memory:' })],
    async onAuthenticate({ token, documentName }) {
      return { user: await authenticate(token, documentName) };
    },
  };
}

/** The WebSocket server (not listening yet: call `listen()`). */
export function createCollabServer(options: CollabOptions & { port: number; address?: string }): Server {
  return new Server({ ...collabConfiguration(options), port: options.port, address: options.address ?? '127.0.0.1' });
}
