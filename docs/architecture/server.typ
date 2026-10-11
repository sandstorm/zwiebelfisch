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
  [`meta`], [written by the server: `baseSha`, `base`, `baseAssets`, `lastCommits`], [GitLab],
)

== GitLab rooms <architecture-server-gitlab>

```
open      no meta: load the branch head (.typ as text, others as blob sha) → files, assets, meta
          stored room: pull upstream (merge), ignoring GitLab being unreachable
save      client: stateless gitlab:save → commitActions(meta, files) → one POST /repository/commits
          refused with a moved head: merge upstream, retry (3 attempts); a conflict ends the save
webhook   POST /gitlab/webhook (X-Gitlab-Token) → merge into the open rooms of that branch
answers   gitlab:saved / merged / conflict to everyone; gitlab:unchanged / error to the saver
```

- *Optimistic concurrency per file*: update / move / delete carry the file's `last_commit_id`, so GitLab refuses an action whose file changed upstream.
- *Commit actions*: a deleted + created pair with at least half the content equal is a `move` (git's rename rule); uploads go as base64.
- *Merge* (`merge.ts`): per path, take upstream where the room did not change it, keep the room's where upstream did not; both changed → `merge3` (node-diff3, by lines); changed vs. deleted → conflict. Any conflict: nothing applied, `gitlab:conflict` with the room's ranges. Otherwise one transaction of minimal text edits, so cursors elsewhere stay put.
- *Files endpoint*: `GET /rooms/<room>/files/<path>` with the room token as Bearer → the bytes of a repository file, from a shared LRU `BlobCache`.

== Entry points <architecture-server-entry-points>

#table(
  columns: (auto, 1fr, 2fr),
  table.header[File][Task][Configuration],
  [`main.ts`], [`server:dev`], [environment variables: @guide-collaboration-server, @guide-collaboration-gitlab],
  [`fake-gitlab-main.ts`], [`demo`, `server:dev-fake-gitlab`, `test:e2e-gitlab`], [`PORT`; plain rooms + `gitlab:demo/report@<any branch>` holding `demo/examples/advanced`; `GET /playground`, `POST /playground/upstream` (simulates a push)],
)

The widget's side (`collaboration` extension, `GitLabSourceControl`): @guide-collaboration and @architecture-built-in-extensions.
