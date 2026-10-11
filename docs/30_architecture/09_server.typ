#import "../template.typ": mermaid

= Server <architecture-server>

`server/` (Node package, Hocuspocus; TypeScript run by Node directly). Relays, authenticates and stores collaboration rooms. Looks inside a room only when it is backed by a GitLab branch.

== Concepts <architecture-server-concepts>

- *Room*: one Y.Doc per project, named by the client. The map names live in `src/core/room-protocol/`, which the server imports (and nothing else of the widget).
- *`collabConfiguration(options)`* (`collab-server.ts`): the Hocuspocus configuration. Extensions in order: storage, `GitLabExtension` (if `gitlab` is set), extra ones (`extensions`). `createCollabServer({ port, … })` wraps it in a `Server` on 127.0.0.1.
- *Storage*: any Hocuspocus extension with `onLoadDocument` / `onStoreDocument`. Default: SQLite at `database` (`:memory:` if unset). It keeps every room's Yjs state, GitLab rooms included.
- *`Authenticate(token, room) → { name?, email? }`* (`auth.ts`): runs per connection; rejecting refuses it. The only one today is the stub `sharedToken(expected)`: no `expected`, everyone may open every room.
- *`GitLabExtension` / `GitLabRoom`* (`gitlab/`): a room named `gitlab:<project id or path>@<branch>` is that branch. The server config holds the only GitLab token.
- *`FakeGitLab`* (`gitlab/fake-gitlab.ts`) and *`playground/`*: an in-memory GitLab and dev-only endpoints for the demo and the e2e specs. Never loaded by `main.ts`.

#table(
  columns: (auto, 1fr, auto),
  table.header[Y.Doc entry][Content][Rooms],
  [`files`], [`Y.Map<path, Y.Text>`: every `.typ` file], [all],
  [awareness], [`user`, `cursor` (relative positions)], [all],
  [`assets`], [`Y.Map<path, sha | Uint8Array>`: other files (blob sha, or uploaded bytes not committed yet)], [GitLab],
  [`meta`], [written by the server: `baseSha`, `base`, `baseAssets`, `lastCommits`; `changes` (what is not in GitLab yet), `conflict` (until resolved), `commitFailure` (until the next commit or merge), `autoCommit` (minutes or null)], [GitLab],
)

== GitLab rooms <architecture-server-gitlab>

#figure(
  mermaid(read("../diagrams/gitlab-room.mmd"), width: 100%),
  caption: [A GitLab room: open, save, auto-commit, webhook and the answers.],
)

- *Optimistic concurrency per file*: update / move / delete carry the file's `last_commit_id`, so GitLab refuses an action whose file changed upstream.
- *Commit actions*: a deleted + created pair with at least half the content equal is a `move` (git's rename rule); uploads go as base64.
- *Merge* (`merge.ts`): per path, take upstream where the room did not change it, keep the room's where upstream did not; both changed → `merge3` (node-diff3, by lines); changed vs. deleted → conflict. Any conflict: nothing applied, `gitlab:conflict` with the room's ranges. Otherwise one transaction of minimal text edits, so cursors elsewhere stay put.
- *Uncommitted changes* (`meta.changes`, `RoomChanges`): the files that differ from the base (`added` / `modified` / `deleted`, from the commit actions), since when, and the editors' names in the order of their first edit. Written 0.5 s after an edit and right after each commit or merge; null when clean.
- *Editors*: every Y.Doc change not made by the room itself is an edit, by the connection's authenticated `user.name`, else the `user.name` its client publishes in the awareness (neither: counted, not named). A commit takes the edits it contains (`Editors.take`); edits made meanwhile stay. Every commit lists the other editors as `Co-authored-by:` (emails as for the author).
- *Auto-commit* (`GitLabOptions.autoCommit`, default 10 minutes, `false`: off): author = most edits; message "Edits by Ann, Bob: a.typ, b.typ, c.typ and 2 more".
- *Conflict*: a failed merge writes `meta.conflict` (`{ sha, paths }`); every new base (merge, commit) clears it.
- *Failed commit* (GitLab unreachable, or refusing the commit; manual or auto): the room writes `meta.commitFailure` (`{ message, at }`), so everyone sees it, also who joins later; every new base (merge, commit) and a conflict (GitLab answered) clear it. A failed auto-commit is tried again after the next edit.
- *Files endpoint*: `GET /rooms/<room>/files/<path>` with the room token as Bearer → the bytes of a repository file, from a shared LRU `BlobCache`.

== Entry points <architecture-server-entry-points>

#table(
  columns: (auto, 1fr, 2fr),
  table.header[File][Task][Configuration],
  [`main.ts`], [`server:dev`], [environment variables: @guide-collaboration-server, @guide-collaboration-gitlab],
  [`fake-gitlab-main.ts`], [`demo`, `server:dev-fake-gitlab`, `test:e2e-gitlab`, the Docker image], [`PORT`, `HOST`; `TYPST_DEMO_DIST`: also serves that built demo on `DEMO_PORT` (5199), as the Docker image does; plain rooms + `gitlab:demo/report@<any branch>` holding `demo/examples/advanced`; `GET /playground`, `POST /playground/upstream` (simulates a push), `POST /playground/outage` (GitLab unreachable for a branch)],
)

The widget's side (`collaboration` extension, `GitLabSourceControl`): @guide-collaboration and @architecture-built-in-extensions.
