= Collaboration server <configuration-collaboration-server>

Setting up collaborative editing. Several people edit the same project at once (Yjs). The host adds the `collaboration` extension with a connection and sets `user`:

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

== Connections <configuration-collaboration-server-connections>

#table(
  columns: 2,
  [`collaboration(…)`], [Connection],
  [`{ url, room, token? }`], [A #link("https://tiptap.dev/docs/hocuspocus")[Hocuspocus] server, e.g. this repository's (@configuration-collaboration-server-running). Until the room has synced, the editing area takes no input: the room's text replaces the local one.],
  [`{ doc, awareness? }`], [A `Y.Doc` you connected and synced yourself (y-websocket, y-webrtc, …); `awareness` for remote cursors. It must come from the widget's Yjs instance: bundle the widget from source with your Yjs. `dist/lib` bundles its own copy.],
)

- The collaboration code loads on demand: widgets that never collaborate never download it.
- `onFilesChange` and `change` also fire for the others' edits.

== The server <configuration-collaboration-server-running>

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

== Trying it locally <configuration-collaboration-server-demo>

`mise run demo` starts the demo with a server whose GitLab is an in-memory fake holding the advanced example (@getting-started-demo).

- *Collaborate:* pick it in the playground bar, then "Open a second window as Bob".
- *GitLab (fake):* pick it, or open `?room=gitlab:demo/report@main`. Any other branch name starts a fresh branch from `main`.
- "Simulate upstream commit" pushes a change to the fake repository: try merges and conflicts.
- `curl -X POST 'http://localhost:1234/playground/outage?room=gitlab:demo/report@main'` makes the fake GitLab unreachable for that branch (`&on=false` ends it): try a failing save.
- The fake repository lives in memory: restart `mise run demo` to reset it.
- `TYPST_GITLAB_AUTO_COMMIT` works here too, e.g. `0.5` to watch saving by itself.
