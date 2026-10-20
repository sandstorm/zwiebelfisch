#import "../template.typ": mermaid, unreviewed

= Server <architecture-server>

#unreviewed

`server/` relays, authenticates and stores the collaboration rooms: one Go binary (`server/cmd/<command>`, `server/lib/<package>`) speaking the #link("https://tiptap.dev/docs/hocuspocus")[Hocuspocus] protocol to the widget's `HocuspocusProvider`. It looks inside a room only when the room is a GitLab branch.

#figure(
  mermaid(read("../diagrams/server.mmd"), width: 90%),
  caption: [The server's packages and who calls them.],
)

Besides those: `diff3` (three-way merge of lines), `config` (koanf), `logging` (zerolog), and for the demo and the tests `fakegitlab` (an in-memory GitLab that also signs people in) and `playground`. `ydoc` is the only importer of #link("https://github.com/reearth/ygo")[`reearth/ygo`]; `store` is SQLite without cgo.

== Rooms

What widget and server agree on is `src/extensions/collaboration/room-protocol.ts`, mirrored in `server/lib/gitlab/protocol.go`; a change to one is a change to the other.

#table(
  columns: (auto, 1fr, auto),
  table.header[Y.Doc entry][Content][Rooms],
  [`files`], [`Y.Map<path, Y.Text>`: every `.typ` file], [all],
  [awareness], [`user`, `cursor` (relative positions)], [all],
  [`project`], [`main`, the main file's path], [plain],
  [`assets`], [the other files: blob sha, or uploaded bytes not committed yet], [GitLab],
  [`meta`], [written by the server only: the base, `changes`, `conflict`, `commitFailure`, `autoCommit`], [GitLab],
)

Inside the server the seams are `collab.Authenticate` (who gets into a room), `collab.Extension` (what a room is; GitLab rooms are one) and `gitlab.Repository` (the provider behind a GitLab room; `api.go` is GitLab's REST).

- *One goroutine per room* owns its Y.Doc: joins, messages and stores are queued to it, so rooms need no locks.
- *Which rooms*: `gitlab:<project>@<branch>` when GitLab is configured; any other name is a *plain room*, backed only by the database, and opens only with `ZWF_PLAIN_ROOMS=1` (the demo, `test:e2e-collab`). Otherwise the client is refused with a reason the widget shows, and `GET /api/public/info` tells clients beforehand. A server with neither does not start.
- *Sign-in* (`auth`): OpenID Connect, authorization code flow with PKCE, state (also in a short cookie, so a sign-in ends in the browser that began it) and nonce. Identity = (provider id, subject); the GitLab instance is the default provider. Sessions and tokens live in memory only: nothing secret on disk, a restart signs everyone out. The session cookie is httpOnly, SameSite=Lax, Secure except on loopback; a request whose `Origin` is another host is nobody's, so the WebSocket needs no origin list.
- *Room auth*: a WebSocket without a session never opens. Then per room, in Hocuspocus' Auth message, with the identity of the upgrade request (the message's token is ignored); nothing of a room is sent before it. A `collab.Refusal` carries the reason the user is told; other errors say `permission-denied`. The room files go through the same check.
- *The widget's side* is the `collaboration` extension (@architecture-extensions-built-in): `GET /api/me` first, the WebSocket only when signed in; a connection closed for an ended session stops reconnecting and offers to sign in (@configuration-collaboration-server).

== Routes <architecture-server-routes>

`/api/public/` is the only part anyone may call; everything else answers only people signed in. `app.New` mounts two muxes, `/api/public/` and `/` behind `requireSignIn`, which answers 401 without a session (with CORS and credentials, so the widget on another port reads it). The public mux panics on a pattern outside its prefix; the tests call every route of both without a session.

Public: `auth/login?return=<url>`, `auth/callback`, `info`, and `gitlab/webhook` (checked by `X-Gitlab-Token`, only with `ZWF_GITLAB_WEBHOOK_SECRET`). Signed in: `GET /api/collaboration` (the WebSocket; 401 before the upgrade), `GET /api/me`, `POST /api/auth/logout`, `GET /api/rooms/<room>/files/<path>`. `fake-gitlab` adds the fake's sign-in page (`/oauth/authorize`) and `/playground/…`, never part of a real deployment.

== GitLab rooms <architecture-server-gitlab>

A room `gitlab:<project id or path>@<branch>` is that branch (`gitlab.Rooms`).

#figure(
  mermaid(read("../diagrams/gitlab-room.mmd"), width: 100%),
  caption: [A GitLab room: open, save, auto-commit, webhook and the answers.],
)

- *The bot commits*: only the server's config holds a token, the bot's; it authors every commit, the editors are `Co-authored-by:` trailers. No user token is used.
- *Access*: the bot's rights must not become everyone's. Joining needs the Developer role or more (asked with the bot's token, cached a minute); a save first checks afresh that the user may push to the branch (protected branches).
- *Branch-level check*: GitLab's commit API cannot require "the branch is still at X", so `Commit` compares the head before and again when GitLab refuses; moved means `ErrConflict`, a merge and a retry. A push landing in between ends up under the room's commit: `parent ≠ base`, and the room merges it.
- *Merging an upstream push*: three-way by lines per path. Any conflict: nothing is applied and `meta.conflict` stays until a merge succeeds. Otherwise minimal edits at UTF-16 offsets, so cursors stay put.
- *Leaving*: the room stays loaded and joinable for 20 s after the last client, then commits; someone back cancels it.

== Commands <architecture-server-commands>

- `zwiebelfisch` (`server:dev`): configured by environment variables (@configuration-collaboration-server-running, @configuration-gitlab-integration).
- `fake-gitlab` (`demo`, `server:dev-fake-gitlab`, `test:e2e-gitlab`, `test:e2e-collab`, the Docker image): as `zwiebelfisch` without database or sign-in settings; the fake GitLab signs anyone in (`login_hint` or `user` at once, as the e2e tests do) and holds `demo/examples/advanced` at `gitlab:demo/report@<any branch>`. `ZWF_DEMO_DIST` also serves the built demo on 5199. `/playground/upstream` pushes, `/playground/outage` makes GitLab unreachable, `/playground/auto-commit` keeps one room from saving by itself.

`mise run server:test` runs the real `HocuspocusProvider` and yjs from Node scripts (`server/testdata/`) against the Go side, in-process; the binaries' tests need a port and skip without one.
