= Collaboration <guide-collaboration>

Several people edit the same project at once (Yjs). The host adds the `collaboration` extension with a connection and sets `user`:

```ts
import { collaboration, createTypstEditor } from 'typst-editor';

createTypstEditor(host, {
  source,                                    // seeds a new room; a room's text wins
  user: { name: 'Ada', color: '#6c71c4' },   // color optional
  extensions: (builtins) => [
    ...builtins,
    collaboration({ url: 'wss://collab.example.org', room: 'project-42', token }),
  ],
});
```

On `<typst-editor>`: `extensions` and `user` go into `options` before the element connects.

== Connections <guide-collaboration-connections>

#table(
  columns: 2,
  [`collaboration(…)`], [Connection],
  [`{ url, room, token? }`], [A #link("https://tiptap.dev/docs/hocuspocus")[Hocuspocus] server, e.g. this repository's (@guide-collaboration-server). The widget shows the local text until the room has synced.],
  [`{ doc, awareness? }`], [A `Y.Doc` you connected and synced yourself (y-websocket, y-webrtc, …); `awareness` for remote cursors. It must come from the widget's Yjs instance: bundle the widget from source with your Yjs. `dist/lib` bundles its own copy.],
)

The collaboration code loads on demand: widgets that never collaborate never download it.

== What is shared <guide-collaboration-shared>

- The text of every `.typ` file, with create, rename and delete. Margin notes are text, so comments are shared too.
- Images and other files: only in GitLab rooms (@guide-collaboration-gitlab). Elsewhere each widget keeps the files it was given.
- Cursors and selections, with each user's name and color; the file panel shows who is in which file.
- Undo reverts only your own edits.
- `onFilesChange` and `change` also fire for the others' edits.

== The server <guide-collaboration-server>

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

== Rooms backed by a GitLab branch <guide-collaboration-gitlab>

With the server configured for GitLab, the room `gitlab:<project id or path>@<branch>` is that branch:

```ts
createTypstEditor(host, {
  main: '/thesis.typ',      // the repository's main file; no source or files needed
  user: { name: 'Ada' },    // the commit author
  extensions: (builtins) => [
    ...builtins,
    collaboration({ url: 'wss://collab.example.org', room: 'gitlab:group/thesis@main', token }),
  ],
});
```

- *Loading:* the first user to open the room makes the server load the branch. `.typ` files become shared text; the widget fetches the other files from the server (`GET /rooms/<room>/files/<path>`, token as `Authorization: Bearer`).
- *Saving:* "Save to GitLab…" in the tab bar asks for a commit message (default "Edit via Typst editor"). The server commits every change since the last commit, uploads included, as one commit by the saving user.
- Everyone in the room sees the outcome: "Saved version 01234567 (Ann)", "No changes to save", "Saving failed: …".
- *Changes on GitLab* (pushes, merges) are merged into the room file by file, three-way: when someone saves, and on push with the webhook.
- *Conflicts:* where the room and GitLab changed the same lines, nothing is merged or committed. Everyone sees "Changes on GitLab conflict with edits in …"; the room keeps its text, without conflict markers. Make the lines match (here or on GitLab), then save again.
- Text files other than `.typ` (CSV, `.bib`, …) are shared whole: when two people type in one at once, the last save wins.

Server configuration, e.g. in a git-ignored `mise.local.toml` `[env]` section (never commit the token):

#table(
  columns: 2,
  [Variable], [Meaning],
  [`TYPST_GITLAB_URL`], [The GitLab instance, e.g. `https://gitlab.com`.],
  [`TYPST_GITLAB_TOKEN`], [Server-side token with `api` scope; clients never see it.],
  [`TYPST_GITLAB_WEBHOOK_SECRET`], [Optional: enables `POST /gitlab/webhook`. Add a push webhook with this secret in the GitLab project.],
  [`TYPST_GITLAB_AUTHOR_EMAIL`], [Optional: the author email when the user's is unknown.],
)

GitLab rooms need both `TYPST_GITLAB_URL` and `TYPST_GITLAB_TOKEN`.

== Trying it locally <guide-collaboration-demo>

`mise run demo` starts the demo with a server whose GitLab is an in-memory fake holding the advanced example (@guide-getting-started-demo).

- *Collaborate:* pick it in the playground bar, then "Open a second window as Bob".
- *GitLab (fake):* pick it, or open `?room=gitlab:demo/report@main`. Any other branch name starts a fresh branch from `main`.
- "Simulate upstream commit" pushes a change to the fake repository: try merges and conflicts.
- The fake repository lives in memory: restart `mise run demo` to reset it.
