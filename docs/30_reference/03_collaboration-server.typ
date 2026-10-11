= Collaboration server <reference-collaboration-server>

Setting up collaborative editing (@features-collaborative-editing) and GitLab rooms (@features-gitlab). Several people edit the same project at once (Yjs). The host adds the `collaboration` extension with a connection and sets `user`:

```ts
import { collaboration, createTypstEditor } from 'typst-editor';

createTypstEditor(host, {
  source,                                    // seeds a new room; a room's text wins
  user: { name: 'Ada', color: '#6c71c4' },   // color optional
  extensions: (builtinExtensions) => [
    ...builtinExtensions,
    collaboration({ url: 'wss://collab.example.org', room: 'project-42', token }),
  ],
});
```

On `<typst-editor>`: `extensions` and `user` go into `options` before the element connects.

== Connections <reference-collaboration-server-connections>

#table(
  columns: 2,
  [`collaboration(…)`], [Connection],
  [`{ url, room, token? }`], [A #link("https://tiptap.dev/docs/hocuspocus")[Hocuspocus] server, e.g. this repository's (@reference-collaboration-server-running). Until the room has synced, the editing area takes no input: the room's text replaces the local one.],
  [`{ doc, awareness? }`], [A `Y.Doc` you connected and synced yourself (y-websocket, y-webrtc, …); `awareness` for remote cursors. It must come from the widget's Yjs instance: bundle the widget from source with your Yjs. `dist/lib` bundles its own copy.],
)

- The collaboration code loads on demand: widgets that never collaborate never download it.
- `onFilesChange` and `change` also fire for the others' edits.
- What is shared: @features-collaborative-editing.

== The server <reference-collaboration-server-running>

`server/` is a Hocuspocus server storing rooms in SQLite. Its internals: @architecture-server.

```sh
mise run server:dev    # ws://127.0.0.1:1234
```

#table(
  columns: 2,
  [Variable], [Meaning],
  [`PORT`], [Default `1234`.],
  [`TYPST_COLLAB_DB`], [SQLite file (default `server/.data/collab.sqlite`).],
  [`TYPST_COLLAB_TOKEN`], [The token clients must send. Unset: no check.],
)

The token check is a stub: one shared token for every room and user.

== Rooms backed by a GitLab branch <reference-collaboration-server-gitlab>

With the server configured for GitLab, the room `gitlab:<project id or path>@<branch>` is that branch:

```ts
createTypstEditor(host, {
  main: '/thesis.typ',      // the repository's main file; no source or files needed
  user: { name: 'Ada' },    // the commit author
  extensions: (builtinExtensions) => [
    ...builtinExtensions,
    collaboration({ url: 'wss://collab.example.org', room: 'gitlab:group/thesis@main', token }),
  ],
});
```

- *Loading:* the first user to open the room makes the server load the branch. `.typ` files become shared text; the widget fetches the other files from the server (`GET /rooms/<room>/files/<path>`, token as `Authorization: Bearer`).
- Saving, merging and conflicts as the users see them: @features-gitlab.

Server configuration, e.g. in a git-ignored `mise.local.toml` `[env]` section (never commit the token):

#table(
  columns: 2,
  [Variable], [Meaning],
  [`TYPST_GITLAB_URL`], [The GitLab instance, e.g. `https://gitlab.com`.],
  [`TYPST_GITLAB_TOKEN`], [Server-side token with `api` scope; clients never see it.],
  [`TYPST_GITLAB_WEBHOOK_SECRET`], [Optional: enables `POST /gitlab/webhook`. Add a push webhook with this secret in the GitLab project.],
  [`TYPST_GITLAB_AUTHOR_EMAIL`], [Optional: the author email when the user's is unknown.],
  [`TYPST_GITLAB_AUTO_COMMIT`], [Minutes without edits before a room saves by itself (default `10`; fractions allowed); `off`: only "Save to GitLab…".],
)

GitLab rooms need both `TYPST_GITLAB_URL` and `TYPST_GITLAB_TOKEN`.

== Trying it locally <reference-collaboration-server-demo>

`mise run demo` starts the demo with a server whose GitLab is an in-memory fake holding the advanced example (@getting-started-demo).

- *Collaborate:* pick it in the playground bar, then "Open a second window as Bob".
- *GitLab (fake):* pick it, or open `?room=gitlab:demo/report@main`. Any other branch name starts a fresh branch from `main`.
- "Simulate upstream commit" pushes a change to the fake repository: try merges and conflicts.
- `curl -X POST 'http://localhost:1234/playground/outage?room=gitlab:demo/report@main'` makes the fake GitLab unreachable for that branch (`&on=false` ends it): try a failing save.
- The fake repository lives in memory: restart `mise run demo` to reset it.
- `TYPST_GITLAB_AUTO_COMMIT` works here too, e.g. `0.5` to watch saving by itself.
