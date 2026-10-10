// The protocol of the rooms (the Y.Doc's maps) and of GitLab-backed rooms (stateless messages, file URLs), shared
// by the widget (the collaboration and versions extensions) and the collaboration server (server/src). No imports:
// the server's Node runtime loads this file directly. Imported directly rather than through model.ts (the lazily
// loaded chunk): an exception to the entry-file rule, listed in eslint.config.js.

/** The Y.Doc map of the shared Typst files: path → Y.Text (see SharedProject; the server reads and merges them). */
export const FILES_MAP = 'files';

/** Room names of GitLab-backed rooms: `gitlab:<project id or path>@<branch>`. */
export const GITLAB_ROOM_PREFIX = 'gitlab:';

/**
 * The Y.Doc map the server keeps the repository state in (clients only read it):
 *
 * | key           | value                                   |
 * |---------------|-----------------------------------------|
 * | `baseSha`     | the commit the room's base is           |
 * | `base`        | `Record<path, string>`: the `.typ` files at `baseSha` |
 * | `baseAssets`  | `Record<path, blobSha>`: the other files at `baseSha` |
 * | `lastCommits` | `Record<path, commitSha>`: per `.typ` file, the commit that last changed it (optimistic concurrency) |
 */
export const META_MAP = 'meta';

/**
 * The Y.Doc map of the project's other files (images, data), written by
 * clients and server: path → blob sha (the file as in the repository, its
 * bytes at `GET /rooms/<room>/files/<path>`) or `Uint8Array` (uploaded, not
 * committed yet).
 */
export const ASSETS_MAP = 'assets';

/** What the meta map holds (see `META_MAP`). */
export interface RoomMeta {
  baseSha: string;
  base: Record<string, string>;
  baseAssets: Record<string, string>;
  lastCommits: Record<string, string>;
}

/** Client → server stateless messages. */
export type ClientMessage = {
  type: 'gitlab:save';
  /** Commit message (default 'Edit via Typst editor'). */
  message?: string;
  /** The commit's author (default: the user the token belongs to). */
  author?: { name: string; email?: string };
};

/** A range of a file's current text that could not be merged with upstream (UTF-16 offsets). */
export interface ConflictRange {
  from: number;
  to: number;
}

export interface FileConflict {
  path: string;
  /** Empty when the file as a whole conflicts (changed on one side, deleted on the other). */
  ranges: ConflictRange[];
}

/** Server → client stateless messages. */
export type ServerMessage =
  /** A version was committed (sent to everyone in the room). */
  | { type: 'gitlab:saved'; sha: string; author: string }
  /** The save of this client had nothing to commit. */
  | { type: 'gitlab:unchanged' }
  /** Upstream changes were merged into the room (sent to everyone). */
  | { type: 'gitlab:merged'; sha: string }
  /** Upstream changes could not be merged; the room's text is kept as it is (sent to everyone). */
  | { type: 'gitlab:conflict'; sha: string; files: FileConflict[] }
  /** The save failed for another reason. */
  | { type: 'gitlab:error'; message: string };

export const DEFAULT_COMMIT_MESSAGE = 'Edit via Typst editor';

/** The HTTP path of a file of a room (relative to the server's base URL). */
export function roomFilePath(room: string, path: string): string {
  return `/rooms/${encodeURIComponent(room)}/files${path.split('/').map(encodeURIComponent).join('/')}`;
}
