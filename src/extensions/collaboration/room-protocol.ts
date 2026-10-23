// What the widget and the collaboration server agree on: the maps of a room's Y.Doc, the messages of GitLab-backed
// rooms, guest links, and the paths of the collaboration WebSocket and a room's file. The server's side is
// server/lib/gitlab/protocol.go and server/lib/guest/guest.go (the paths: server/lib/app/app.go); a change here is a
// change there. Outside the
// lazily loaded model/ (which uses most of it), so the eager account.ts can build the WebSocket's URL. See
// collaboration in collaboration.ts.
import { ProjectPath } from '../../core/paths/paths';

/**
 * The Y.Doc map of the shared Typst files: path → Y.Text (written by the collaboration extension's SharedProject; the
 * server reads and merges them in GitLab rooms).
 */
export const FILES_MAP = 'files';

/**
 * The Y.Doc map of the project's state besides its files, written by clients: `main`, the path of the main file
 * (collaboration's SharedMainFile; not in GitLab-backed rooms).
 */
export const PROJECT_MAP = 'project';

/**
 * Room names of GitLab-backed rooms: `gitlab:<project id or path>@<branch>`, or `gitlab:<project>@<branch>:/<folder>`
 * for a room of one folder of the branch (see `gitlabRoomFolder`).
 */
export const GITLAB_ROOM_PREFIX = 'gitlab:';

/**
 * The folder a GitLab room holds (`/reports/q1` of `gitlab:group/report@main:/reports/q1`): its files, and the files
 * from outside it that it pulled in (`gitlab:pull`), at their paths in the repository. Null: the whole branch, or
 * not a GitLab room.
 */
export function gitlabRoomFolder(room: string): ProjectPath | null {
  if (!room.startsWith(GITLAB_ROOM_PREFIX)) return null;
  const branch = room.slice(room.indexOf('@') + 1);
  const colon = branch.indexOf(':');
  return colon < 0 ? null : ProjectPath.parse(branch.slice(colon + 1));
}

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
 * | `commitFailure` | `CommitFailure \| null`: the last commit failed (GitLab unreachable or refusing it), or what it left out (in a room of one folder); cleared by the next commit or merge, a conflict, or when nothing is left to commit |
 * | `autoCommit`  | `number \| null`: the minutes without edits after which the server commits by itself (also when the last user leaves); null: never |
 * | `pulledIn`    | `string[]`: the files from outside the room's folder it holds (`gitlab:pull`) |
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
  /** Their user ids on the server's GitLab, as `editors` (`''`: not known): whom the server asks whether it may commit by itself. */
  editorIds?: string[];
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
export type ClientMessage =
  | {
      type: 'gitlab:save';
      /** Commit message (default 'Edit via Zwiebelfisch'). The commit is by the signed-in user who saves. */
      message?: string;
    }
  /** Asks for a file from outside the room's folder, as it is at the room's base: it comes into the room, else `gitlab:missing` says why not. */
  | { type: 'gitlab:pull'; path: ProjectPath };

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
  | { type: 'gitlab:error'; message: string }
  /** A file this client asked for (`gitlab:pull`) does not come: not in the repository, or too many or too large. */
  | { type: 'gitlab:missing'; path: string; message: string };

export const DEFAULT_COMMIT_MESSAGE = 'Edit via Zwiebelfisch';

/** The `commitFailure` message of an auto-save that guest edits held back: guests never save, a member must. */
export const GUEST_EDITS = 'Guest edits: a member must save.';

/** The identity provider of a guest (`Identity.provider`): someone a member shared one room with, by a link. */
export const GUEST_PROVIDER = 'guest';

/** Server → client stateless message: the room's guest links or its guests changed (refetch `roomSharesPath`). */
export const GUESTS_CHANGED = JSON.stringify({ type: 'guests:changed' });

/** Where a guest link's page signs its guest in (relative to the server's URL): `POST {token, name}` (JSON). */
export const GUEST_JOIN_PATH = '/api/public/guest/join';

/**
 * The HTTP path of a room's guest links (relative to the server's URL): `GET` answers `{ shares: Share[] }`, `POST
 * {label, days}` makes one (answering it with its `token`, once), `DELETE <path>/<id>` revokes one.
 */
export function roomSharesPath(room: string): string {
  return `/api/rooms/${encodeURIComponent(room)}/shares`;
}

/** A guest link of a room: to a member, with its id and the names of its guests in the room; to a guest, their own. */
export interface Share {
  id?: string;
  label: string;
  /** The member who made it, by name. */
  sharedBy: string;
  /** Milliseconds since the epoch, the server's clock. */
  createdAt: number;
  expiresAt: number;
  online?: string[];
  /** Only in the answer that made it: the link's secret. */
  token?: string;
}

/** The lifetimes a guest link may have, in days; `DEFAULT_GUEST_DAYS` preselected. */
export const GUEST_LIFETIMES = [1, 7, 30] as const;
export const DEFAULT_GUEST_DAYS = 7;

/** The path of the collaboration WebSocket (relative to the server's URL): one connection carries the rooms joined; signed in only, like every path outside `/api/public/`. */
export const COLLABORATION_PATH = '/api/collaboration';

/** The HTTP path of a file of a room (relative to the server's URL); with `ref`, of the file at that commit (a GitLab room's). */
export function roomFilePath(room: string, path: string, ref?: string): string {
  const query = ref === undefined ? '' : `?ref=${encodeURIComponent(ref)}`;
  return `/api/rooms/${encodeURIComponent(room)}/files${path.split('/').map(encodeURIComponent).join('/')}${query}`;
}

/**
 * The HTTP path of a GitLab room's history (relative to the server's URL): `GET` answers a `HistoryPage` of the commits
 * that changed `path` (`''`: the room's folder, else the whole branch; `/dir/`: a folder; `/a.typ`: a file), newest
 * first, from the room's base commit or from `cursor` on, at most `limit` (the server's most: 50).
 */
export function roomHistoryPath(room: string, query: { path?: string; cursor?: string; limit?: number }): string {
  const params = new URLSearchParams();
  if (query.path) params.set('path', query.path);
  if (query.cursor) params.set('cursor', query.cursor);
  if (query.limit) params.set('limit', String(query.limit));
  return `/api/rooms/${encodeURIComponent(room)}/history?${params}`;
}

/** The HTTP path of the files commit `sha` of a GitLab room's branch changed (relative to the server's URL): `GET` answers a `CompareAnswer`. */
export function roomComparePath(room: string, sha: string): string {
  return `/api/rooms/${encodeURIComponent(room)}/compare?sha=${encodeURIComponent(sha)}`;
}

/** A page of a GitLab room's history (`roomHistoryPath`), and where it goes on (missing: no more). */
export interface HistoryPage {
  commits: HistoryCommit[];
  cursor?: string;
}

export interface HistoryCommit {
  sha: string;
  parents: string[];
  /** Trailers included. */
  message: string;
  /** When it was committed: milliseconds since the epoch. */
  at: number;
  /** Who made it, by name: the author, then the co-authors (Co-authored-by); never the committer Zwiebelfisch. */
  people: string[];
}

/** The files a commit changed against its first parent (`roomComparePath`): in a room of one folder, only those it holds or pulled in. */
export interface CompareAnswer {
  files: { path: string; previousPath?: string; kind: 'added' | 'modified' | 'deleted' | 'renamed' }[];
}
