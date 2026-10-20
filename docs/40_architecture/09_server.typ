#import "../template.typ": mermaid, unreviewed

= Server <architecture-server>

#unreviewed

`server/` relays, authenticates and stores the collaboration rooms. It is one Go binary (module at the repository root, `server/cmd/<command>`, `server/lib/<package>`) that speaks the #link("https://tiptap.dev/docs/hocuspocus")[Hocuspocus] protocol to the widget's `HocuspocusProvider`. It looks inside a room only when the room is a GitLab branch.

#figure(
  mermaid(read("../diagrams/server.mmd"), width: 90%),
  caption: [The server's packages and who calls them.],
)

#table(
  columns: (auto, 1fr),
  table.header[Package][Task],
  [`app`], [Puts it together on one port: the rooms, GitLab rooms as their extension, the sign-in, every route (@architecture-server-routes); who opens which room; `Run` (serve until SIGINT/SIGTERM, then store the open rooms)],
  [`auth`], [The sign-in: an OpenID Connect relying party (`coreos/go-oidc`, `x/oauth2`), sessions in memory, `Identify(request)`; its handlers, which `app` mounts],
  [`collab`], [The Hocuspocus protocol and the rooms: auth per room, sync, awareness, stateless messages, debounced storing, unloading. `Authenticate` decides who gets in; an `Extension` decides what a room is],
  [`ydoc`], [The Yjs document (#link("https://github.com/reearth/ygo")[`reearth/ygo`]), its sync protocol and awareness; the only importer of ygo],
  [`store`], [Room states in SQLite (`modernc.org/sqlite`, no cgo)],
  [`gitlab`], [GitLab rooms: load, commit, merge pushes, the room files and the webhook; `Repository` is the provider seam, `api.go` GitLab's REST behind it],
  [`diff3`], [Three-way merge of lines (a port of node-diff3)],
  [`config`, `logging`], [Environment variables (koanf), zerolog],
  [`fakegitlab`, `playground`], [The demo and the tests: an in-memory GitLab with members, protected branches and a sign-in (an OpenID Connect provider: any name, no password), the playground endpoints, the built demo served without Vite],
)

- *Rooms*: one Y.Doc per project, named by the client. A room runs on its own goroutine, which owns the document: joins, messages and stores are queued to it, so rooms need no locks.
- *Which rooms*: `gitlab:<project>@<branch>` when GitLab is configured. Any other name is a *plain room*, backed by nothing but the database: only with `ZWF_PLAIN_ROOMS=1` (the demo and `test:e2e-collab` set it). Without it the client is refused with a reason the widget shows ("This server opens only GitLab rooms …"), and `GET /api/public/info` (`{"plainRooms": false}`) tells clients beforehand. A server with neither does not start.
- *Sign-in* (`auth`): authorization code flow with PKCE, state (also in a short cookie, so a sign-in ends only in the browser that began it) and nonce; the ID token is verified with the provider's keys. Identity = (provider id, subject): with the GitLab instance as the provider (the default), `gitlab` and the GitLab user id. Sessions and the user's tokens live in memory only: no table, nothing secret on disk; a restart signs everyone out. The session cookie is httpOnly, SameSite=Lax, Secure except on loopback hosts; a request whose `Origin` is another host is nobody's, so the WebSocket needs no origin list.
- *Auth*: a WebSocket without a session never opens (401, @architecture-server-routes). Then per room (`app`), in the Hocuspocus Auth message, with the identity of the upgrade request (the message's token is ignored); nothing of a room is sent before it. The room must exist here, and for a GitLab room the user have a role that edits. A `collab.Refusal` carries the reason the client is told; other errors say `permission-denied`. The room files go through the same check.
- *The widget's side* is the `collaboration` extension: it asks `GET /api/me` first, and only signed in opens the WebSocket; a connection that closes for an ended session stops reconnecting and offers to sign in again (@configuration-collaboration-server, @architecture-extensions-built-in); the Y.Doc layout is `src/core/room-protocol/`, mirrored in `server/lib/gitlab/protocol.go`.

#table(
  columns: (auto, 1fr, auto),
  table.header[Y.Doc entry][Content][Rooms],
  [`files`], [`Y.Map<path, Y.Text>`: every `.typ` file], [all],
  [awareness], [`user`, `cursor` (relative positions)], [all],
  [`project`], [`Y.Map`: `main`, the main file's path], [plain],
  [`assets`], [`Y.Map<path, sha | Uint8Array>`: the other files (blob sha, or uploaded bytes not committed yet)], [GitLab],
  [`meta`], [written by the server: the base (`baseSha`, `base`, `baseAssets`), `changes`, `conflict`, `commitFailure`, `autoCommit`], [GitLab],
)

== Routes <architecture-server-routes>

One rule, visible in every path: `/api/public/` is the only part anyone may call; everything else answers only people signed in. `app.New` lists every route in two muxes: `mux.Handle("/api/public/", public)` and `mux.Handle("/", requireSignIn(signedIn))`. `requireSignIn` answers 401 without a session (with CORS and credentials, so the widget on another port reads it) and puts the identity into the request (`auth.SignedIn`). The public mux takes no pattern outside its prefix (it panics); the tests try every route of both without a session.

#table(
  columns: (auto, 1fr),
  table.header[Route][What],
  [`GET /api/public/auth/login?return=<url>`], [Public: signing in begins signed out. To the provider, then back to `<url>` (this host)],
  [`GET /api/public/auth/callback`], [Public: the redirect URI the provider sends the browser back to; starts the session],
  [`GET /api/public/info`], [Public: what the server offers (`{"plainRooms": …}`), read before signing in],
  [`POST /api/public/gitlab/webhook`], [Public: GitLab calls it, checked by `X-Gitlab-Token` (only with `ZWF_GITLAB_WEBHOOK_SECRET`)],
  [`GET /api/collaboration`], [The WebSocket (Hocuspocus); 401 before the upgrade],
  [`GET /api/me`], [Who is signed in],
  [`POST /api/auth/logout`], [Ends the session],
  [`GET /api/rooms/<room>/files/<path>`], [A file of an open GitLab room],
)

Any other path is 404 (401 first without a session). The demo's server (`fake-gitlab`) adds its own: the fake GitLab's sign-in page under GitLab's path (`/oauth/authorize`) and `/playground/…` (@architecture-server-commands); never part of a real deployment.

== GitLab rooms <architecture-server-gitlab>

A room named `gitlab:<project id or path>@<branch>` is that branch (`gitlab.Rooms`, one `room` each). `gitlab` is the provider id, the seam for other instances and providers.

#figure(
  mermaid(read("../diagrams/gitlab-room.mmd"), width: 100%),
  caption: [A GitLab room: open, save, auto-commit, webhook and the answers.],
)

- *The bot commits*: only the server's config holds a token, the bot's; it is every commit's author. The editors are `Co-authored-by:` trailers; no user token is used or kept.
- *Access* (`access.go`): since the bot's rights must not become everyone's, `Rooms.Authorize` lets in members with the Developer role or more (`members/all/:user`, asked with the bot's token, kept a minute), and a save first checks that the user may push to the branch (`protected_branches`: roles, users, groups, wildcards), afresh. `Repository.Access` is the provider seam.
- *Branch-level check*: GitLab's commit API cannot require "the branch is still at X". `Commit` compares the head first and again when GitLab refuses an action; moved means `ErrConflict`, a merge and a retry. A push that lands in between unrefused ends up under the room's commit: the room sees `parent ≠ base` and merges it.
- *Merge of an upstream push*: per path, three-way by lines (`diff3`). Any conflict: nothing is applied and `meta.conflict` stays until a merge succeeds. Otherwise minimal edits at UTF-16 offsets, so cursors stay put.
- *Leaving*: `Handler.Left` keeps the room loaded (and joinable) for `LeaveDelay` (20 s), then commits; someone back cancels it.
- *Files endpoint*: `GET /api/rooms/<room>/files/<path>`, for whom the room lets in (CORS with credentials for the page's host), returns a repository file's bytes from a blob cache (by sha, 64 MB).

Depth (commit actions, renames, `meta.changes`, `meta.commitFailure`, the operation queue): `room` in `server/lib/gitlab/room.go`.

== Commands <architecture-server-commands>

#table(
  columns: (auto, 1fr, 2fr),
  table.header[Command][Task][Configuration],
  [`zwiebelfisch`], [`server:dev`], [environment variables: @configuration-collaboration-server-running, @configuration-gitlab-integration],
  [`fake-gitlab`], [`demo`, `server:dev-fake-gitlab`, `test:e2e-gitlab`, `test:e2e-collab`, the Docker image], [as `zwiebelfisch` (no database, no sign-in settings); GitLab is the fake, which also signs people in (its page: `GET /oauth/authorize` on this port; `login_hint` or `user` signs in at once, as the e2e tests do): `gitlab:demo/report@<any branch>` holds `demo/examples/advanced`. `ZWF_DEMO_DIST` also serves that built demo on `DEMO_PORT` (5199). `GET /playground`, `POST /playground/upstream` (a push), `POST /playground/outage` (GitLab unreachable), `POST /playground/auto-commit` (one room never saves by itself: the e2e leave-warning test)],
)

Tests (`mise run server:test`) run the real `HocuspocusProvider` and yjs from Node scripts (`server/testdata/`) against the Go side, in-process; the binaries' tests need a port and skip without one.
