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

The collaboration code loads on demand. `onDidChangeFiles` and `change` also fire for the others' edits.

== The server <configuration-collaboration-server-running>

`server/` is a Go server that stores rooms in SQLite (@architecture-server). Its rooms are GitLab branches (@configuration-gitlab-integration); rooms of any other name (*plain rooms*) only when enabled. Run it with:

```sh
mise run server:dev    # ws://127.0.0.1:1234
```

#table(
  columns: 2,
  [Variable], [Meaning],
  [`PORT`], [Default `1234`.],
  [`TYPST_ADDRESS`], [The interface to listen on (default `127.0.0.1`; `0.0.0.0` in a container).],
  [`TYPST_COLLAB_DB`], [The SQLite file (default `server/.data/collab.sqlite`; `:memory:` keeps nothing).],
  [`TYPST_COLLAB_TOKEN`], [The token clients must send. Unset: no check.],
  [`TYPST_PLAIN_ROOMS`], [`1`: also open plain rooms. Default off: a client asking for one is refused, and the widget says why.],
  [`TYPST_LOG_LEVEL`, `TYPST_LOG_FORMAT`], [`debug` … `error` (default `info`); `console` (default) or `json`.],
)

The token check is a stub: one shared token for every room and user. A server with neither GitLab nor plain rooms does not start. `GET /api/info` answers `{"plainRooms": true|false}`, for clients to offer only rooms that work.

== Trying it locally <configuration-collaboration-server-demo>

`mise run demo` starts the demo with a server whose GitLab is an in-memory fake (@getting-started-demo).

- *GitLab (fake):* pick it, or open `?room=gitlab:demo/report@main`. Another branch name starts a fresh branch from `main`.
- *Collaborate:* a plain room (the playground server enables them; the bar offers it once the server says so), then "Open a second window as Bob".
- "Simulate upstream commit" pushes a change to the fake repository, to try merges and conflicts.
- `curl -X POST 'http://localhost:1234/playground/outage?room=gitlab:demo/report@main'` makes the fake GitLab unreachable (`&on=false` ends it).
- Restart `mise run demo` to reset the fake repository.
