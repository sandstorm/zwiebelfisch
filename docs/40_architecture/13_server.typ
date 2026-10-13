#import "../template.typ": mermaid

= Server <architecture-server>

`server/` relays, authenticates and stores the collaboration rooms. It is a #link("https://tiptap.dev/docs/hocuspocus")[Hocuspocus] server in TypeScript, run by Node directly. It looks inside a room only when the room is a GitLab branch.

== Concepts <architecture-server-concepts>

```ts
// collab-server.ts: a Server on 127.0.0.1, or its configuration alone (tests run it in-process)
function createCollabServer(options: CollabOptions & { port: number; address?: string }): Server;
function collabConfiguration(options?: CollabOptions): Partial<Configuration>;
interface CollabOptions { storage?; database?; authenticate?; debounce?; quiet?; gitlab?: GitLabOptions; extensions? }

// auth.ts: runs per connection; rejecting refuses it
type Authenticate = (token: string, room: string) => Promise<AuthenticatedUser>; // { name?, email? }
```

- *Room*: one Y.Doc per project, named by the client. Its map names live in `src/core/room-protocol/`, the only part of the widget the server imports.
- *Extensions*, in order: storage, `GitLabExtension` (when `gitlab` is set), then `extensions`.
- *Storage*: any Hocuspocus extension with `onLoadDocument` / `onStoreDocument`. Default: SQLite at `database` (`:memory:` when unset). It stores every room, GitLab rooms included.
- *`Authenticate`*: the only one today is the stub `sharedToken(expected)`. Without `expected`, everyone opens every room.
- *`FakeGitLab`* (`gitlab/fake-gitlab.ts`) and `playground/` are an in-memory GitLab and dev endpoints for the demo and the e2e specs. `main.ts` never loads them.

#table(
  columns: (auto, 1fr, auto),
  table.header[Y.Doc entry][Content][Rooms],
  [`files`], [`Y.Map<path, Y.Text>`: every `.typ` file], [all],
  [awareness], [`user`, `cursor` (relative positions)], [all],
  [`assets`], [`Y.Map<path, sha | Uint8Array>`: the other files (blob sha, or uploaded bytes not committed yet)], [GitLab],
  [`meta`], [written by the server: the base (`baseSha`, `base`, `baseAssets`, `lastCommits`), `changes`, `conflict`, `commitFailure`, `autoCommit`; see `room-protocol.ts`], [GitLab],
)

== GitLab rooms <architecture-server-gitlab>

A room named `gitlab:<project id or path>@<branch>` is that branch (`GitLabExtension`, `GitLabRoom` in `gitlab/`). Only the server config holds a GitLab token.

#figure(
  mermaid(read("../diagrams/gitlab-room.mmd"), width: 100%),
  caption: [A GitLab room: open, save, auto-commit, webhook and the answers.],
)

- *Optimistic concurrency per file*: update, move and delete carry the file's `last_commit_id`, so GitLab refuses them when the file changed upstream.
- *Commit actions*: a deleted + created pair with at least half the content equal is a `move`, as git detects renames.
- *Merge* (`merge.ts`): per path, take the side that changed; both changed → `merge3` by lines. Any conflict: nothing is applied and `meta.conflict` is set. Otherwise minimal text edits, so cursors stay put.
- *Uncommitted changes* (`meta.changes`): the files that differ from the base, since when, and who edited them.
- *Editors* (`editors.ts`): every change not made by the room is an edit by the connection's user. A commit names the others as `Co-authored-by:`.
- *Auto-commit* (`GitLabOptions.autoCommit`, default 10 minutes idle): the author is who edited most.
- *Failure*: a failed commit sets `meta.commitFailure`, so everyone sees it. The next commit or merge clears it and `meta.conflict`.
- *Files endpoint*: `GET /rooms/<room>/files/<path>` with the room token as Bearer returns a repository file's bytes, from a shared `BlobCache`.

== Entry points <architecture-server-entry-points>

#table(
  columns: (auto, 1fr, 2fr),
  table.header[File][Task][Configuration],
  [`main.ts`], [`server:dev`], [environment variables: @configuration-collaboration-server-running, @configuration-gitlab-integration],
  [`fake-gitlab-main.ts`], [`demo`, `server:dev-fake-gitlab`, `test:e2e-gitlab`, the Docker image], [`PORT`, `HOST`; `TYPST_DEMO_DIST` also serves that built demo on `DEMO_PORT` (5199); a GitLab room `gitlab:demo/report@<any branch>` with `demo/examples/advanced`; `GET /playground`, `POST /playground/upstream` (a push), `POST /playground/outage` (GitLab unreachable)],
)

The widget's side is the `collaboration` extension (@configuration-collaboration-server, @architecture-built-in-extensions).
