/**
 * The Y.Doc map of the shared Typst files: path → Y.Text (written by the collaboration extension's SharedProject; the
 * server reads and merges them in GitLab rooms).
 *
 * This file is the widget's side of what it and the collaboration server agree on: the maps of a room's Y.Doc, the
 * messages of GitLab-backed rooms, and the paths of the rooms' WebSocket and a room's file. The server's side is
 * server/lib/gitlab/protocol.go (the paths: server/lib/app/app.go); a change here is a change there.
 */
export const FILES_MAP = 'files';

/**
 * The Y.Doc map of the project's state besides its files, written by clients: `main`, the path of the main file
 * (collaboration's SharedMainFile; not in GitLab-backed rooms).
 */
export const PROJECT_MAP = 'project';

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
 * | `changes`     | `RoomChanges \| null`: what the room has that the branch has not (kept up to date while people edit) |
 * | `conflict`    | `RoomConflict \| null`: upstream changes that conflict with the room's; nothing is committed until resolved |
 * | `commitFailure` | `CommitFailure \| null`: the last commit failed (GitLab unreachable or refusing it); cleared by the next commit or merge, or a conflict |
 * | `autoCommit`  | `number \| null`: the minutes without edits after which the server commits by itself (also when the last user leaves); null: never |
 */
export const META_MAP = 'meta';

/**
 * The Y.Doc map of the project's other files (images, data), written by
 * clients and server: path → blob sha (the file as in the repository, its
 * bytes at `GET /api/rooms/<room>/files/<path>`) or `Uint8Array` (uploaded, not
 * committed yet).
 */
export const ASSETS_MAP = 'assets';

/** What the meta map holds (see `META_MAP`). */
export interface RoomMeta {
  baseSha: string;
  base: Record<string, string>;
  baseAssets: Record<string, string>;
}

/** What the room has that its branch has not (`changes` in the meta map; null or missing: nothing). */
export interface RoomChanges {
  /** The files that differ from the base, by path. */
  files: ChangedFile[];
  /** When the first of these edits was made (milliseconds since the epoch, the server's clock). */
  since: number;
  /** Who made them, by name, in the order of their first edit. */
  editors: string[];
}

/** A file of the room that differs from the base: new, changed, or gone (a rename is both). */
export interface ChangedFile {
  path: string;
  kind: 'added' | 'modified' | 'deleted';
}

/** Upstream changes that could not be merged into the room (`conflict` in the meta map): which commit, which files. */
export interface RoomConflict {
  sha: string;
  paths: string[];
}

/** Why the room's last commit failed, and when (`commitFailure` in the meta map): GitLab unreachable, or refusing it. */
export interface CommitFailure {
  message: string;
  /** Milliseconds since the epoch, the server's clock. */
  at: number;
}

/** Client → server stateless messages. */
export type ClientMessage = {
  type: 'gitlab:save';
  /** Commit message (default 'Edit via Zwiebelfisch'). */
  message?: string;
  /** Who saves, named in `gitlab:saved` when the server knows no name for the client (the commit's author is the server's bot). */
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
  /** A version was committed (sent to everyone in the room); `automatic`: by the server, not on a client's save. */
  | { type: 'gitlab:saved'; sha: string; author: string; automatic?: boolean }
  /** The save of this client had nothing to commit. */
  | { type: 'gitlab:unchanged' }
  /** Upstream changes were merged into the room (sent to everyone). */
  | { type: 'gitlab:merged'; sha: string }
  /** Upstream changes could not be merged; the room's text is kept as it is (sent to everyone). */
  | { type: 'gitlab:conflict'; sha: string; files: FileConflict[] }
  /** The save failed for another reason. */
  | { type: 'gitlab:error'; message: string };

export const DEFAULT_COMMIT_MESSAGE = 'Edit via Zwiebelfisch';

/** The path of the rooms' WebSocket (relative to the server's URL); signed in only, like every path outside `/api/public/`. */
export const ROOMS_PATH = '/api/rooms';

/** The HTTP path of a file of a room (relative to the server's URL). */
export function roomFilePath(room: string, path: string): string {
  return `${ROOMS_PATH}/${encodeURIComponent(room)}/files${path.split('/').map(encodeURIComponent).join('/')}`;
}
