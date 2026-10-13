= Collaboration server <configuration-collaboration-server>

Several people can edit the same project at once (#link("https://yjs.dev/")[Yjs]). Add the `collaboration` extension with a connection and set `user`:

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

On `<typst-editor>`, put `extensions` and `user` into `options` before the element connects.

== Connections <configuration-collaboration-server-connections>

`collaboration(…)` takes one of:

- *`{ url, room, token? }`*: a #link("https://tiptap.dev/docs/hocuspocus")[Hocuspocus] server, e.g. this repository's (@configuration-collaboration-server-running).
- *`{ doc, awareness? }`*: a `Y.Doc` you connected and synced yourself (y-websocket, y-webrtc, …); `awareness` for remote cursors. It must use the editor's Yjs instance, so bundle the editor from source; `dist/lib` has its own copy.

The collaboration code loads on demand. `onFilesChange` and `change` also fire for the others' edits.

== The server <configuration-collaboration-server-running>

`server/` is a Hocuspocus server that stores rooms in SQLite (@architecture-server). Run it with:

```sh
mise run server:dev    # ws://127.0.0.1:1234
```

#table(
  columns: 2,
  [Variable], [Meaning],
  [`PORT`], [Default `1234`.],
  [`TYPST_COLLAB_DB`], [The SQLite file (default `server/.data/collab.sqlite`).],
  [`TYPST_COLLAB_TOKEN`], [The token clients must send. Unset: no check.],
)

The token check is a stub: one shared token for every room and user.

== Trying it locally <configuration-collaboration-server-demo>

`mise run demo` starts the demo with a server whose GitLab is an in-memory fake (@getting-started-demo).

- *Collaborate:* pick it in the playground bar, then "Open a second window as Bob".
- *GitLab (fake):* pick it, or open `?room=gitlab:demo/report@main`. Another branch name starts a fresh branch from `main`.
- "Simulate upstream commit" pushes a change to the fake repository, to try merges and conflicts.
- `curl -X POST 'http://localhost:1234/playground/outage?room=gitlab:demo/report@main'` makes the fake GitLab unreachable (`&on=false` ends it).
- Restart `mise run demo` to reset the fake repository.
