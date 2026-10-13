#import "../template.typ": mermaid

= Server <architecture-server>

`server/` relays, authenticates and stores the collaboration rooms. It is one Go binary (module at the repository root, `server/cmd/<command>`, `server/lib/<package>`) that speaks the #link("https://tiptap.dev/docs/hocuspocus")[Hocuspocus] protocol to the widget's `HocuspocusProvider`. It looks inside a room only when the room is a GitLab branch.

#figure(
  mermaid(read("../diagrams/server.mmd"), width: 90%),
  caption: [The server's packages and who calls them.],
)

#table(
  columns: (auto, 1fr),
  table.header[Package][Task],
  [`app`], [Puts it together on one port: the rooms, GitLab rooms as their extension, `GET /api/info`, the GitLab endpoints; which rooms exist; `Run` (serve until SIGINT/SIGTERM, then store the open rooms)],
  [`collab`], [The Hocuspocus protocol and the rooms: auth per room, sync, awareness, stateless messages, debounced storing, unloading. `Authenticate` decides who gets in; an `Extension` decides what a room is],
  [`ydoc`], [The Yjs document (#link("https://github.com/reearth/ygo")[`reearth/ygo`]), its sync protocol and awareness; the only importer of ygo],
  [`store`], [Room states in SQLite (`modernc.org/sqlite`, no cgo)],
  [`gitlab`], [GitLab rooms: load, commit, merge pushes, the room files and the webhook; `Repository` is the provider seam, `api.go` GitLab's REST behind it],
  [`diff3`], [Three-way merge of lines (a port of node-diff3)],
  [`config`, `logging`], [Environment variables (koanf), zerolog],
  [`fakegitlab`, `playground`], [The demo and the tests: an in-memory GitLab, the playground endpoints, the built demo served without Vite],
)

- *Rooms*: one Y.Doc per project, named by the client. A room runs on its own goroutine, which owns the document: joins, messages and stores are queued to it, so rooms need no locks.
- *Which rooms*: `gitlab:<project>@<branch>` when GitLab is configured. Any other name is a *plain room*, backed by nothing but the database: only with `TYPST_PLAIN_ROOMS=1` (the demo and `test:e2e-collab` set it). Without it the client is refused with a reason the widget shows ("This server opens only GitLab rooms …"), and `GET /api/info` (`{"plainRooms": false}`) tells clients beforehand. A server with neither does not start.
- *Auth*: per room, in the Hocuspocus Auth message; nothing of a room is sent before it. `collab.SharedToken` is a stub (one token for all, or none). A `collab.Refusal` carries the reason the client is told; other errors say `permission-denied`.
- *The widget's side* is the `collaboration` extension (@configuration-collaboration-server, @architecture-extensions-built-in); the Y.Doc layout is `src/core/room-protocol/`, mirrored in `server/lib/gitlab/protocol.go`.

#table(
  columns: (auto, 1fr, auto),
  table.header[Y.Doc entry][Content][Rooms],
  [`files`], [`Y.Map<path, Y.Text>`: every `.typ` file], [all],
  [awareness], [`user`, `cursor` (relative positions)], [all],
  [`project`], [`Y.Map`: `main`, the main file's path], [plain],
  [`assets`], [`Y.Map<path, sha | Uint8Array>`: the other files (blob sha, or uploaded bytes not committed yet)], [GitLab],
  [`meta`], [written by the server: the base (`baseSha`, `base`, `baseAssets`), `changes`, `conflict`, `commitFailure`, `autoCommit`], [GitLab],
)

== GitLab rooms <architecture-server-gitlab>

A room named `gitlab:<project id or path>@<branch>` is that branch (`gitlab.Rooms`, one `room` each). `gitlab` is the provider id: it is also in the webhook's path, the seam for other instances and providers.

#figure(
  mermaid(read("../diagrams/gitlab-room.mmd"), width: 100%),
  caption: [A GitLab room: open, save, auto-commit, webhook and the answers.],
)

- *The bot commits*: only the server's config holds a token, the bot's; it is every commit's author. The editors are `Co-authored-by:` trailers; no user token is used or kept.
- *Branch-level check*: GitLab's commit API cannot require "the branch is still at X". `Commit` compares the head first and again when GitLab refuses an action; moved means `ErrConflict`, a merge and a retry. A push that lands in between unrefused ends up under the room's commit: the room sees `parent ≠ base` and merges it.
- *Merge of an upstream push*: per path, three-way by lines (`diff3`). Any conflict: nothing is applied and `meta.conflict` stays until a merge succeeds. Otherwise minimal edits at UTF-16 offsets, so cursors stay put.
- *Leaving*: `Handler.Left` keeps the room loaded (and joinable) for `LeaveDelay` (20 s), then commits; someone back cancels it.
- *Files endpoint*: `GET /rooms/<room>/files/<path>` with the room token as Bearer returns a repository file's bytes from a blob cache (by sha, 64 MB).

Depth (commit actions, renames, `meta.changes`, `meta.commitFailure`, the operation queue): `room` in `server/lib/gitlab/room.go`.

== Commands <architecture-server-commands>

#table(
  columns: (auto, 1fr, 2fr),
  table.header[Command][Task][Configuration],
  [`typst-server`], [`server:dev`], [environment variables: @configuration-collaboration-server-running, @configuration-gitlab-integration],
  [`fake-gitlab`], [`demo`, `server:dev-fake-gitlab`, `test:e2e-gitlab`, the Docker image], [as `typst-server` (no database, no token); GitLab is the fake: `gitlab:demo/report@<any branch>` holds `demo/examples/advanced`. `TYPST_DEMO_DIST` also serves that built demo on `DEMO_PORT` (5199). `GET /playground`, `POST /playground/upstream` (a push), `POST /playground/outage` (GitLab unreachable)],
)

Tests (`mise run server:test`) run the real `HocuspocusProvider` and yjs from Node scripts (`server/testdata/`) against the Go side, in-process; the binaries' tests need a port and skip without one.
