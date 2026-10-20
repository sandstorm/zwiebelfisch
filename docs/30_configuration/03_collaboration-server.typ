#import "../template.typ": unreviewed

= Collaboration server <configuration-collaboration-server>

#unreviewed

Several people can edit the same project at once (#link("https://yjs.dev/")[Yjs]). Add the `collaboration` extension with a connection:

```ts
import { collaboration, createEditor } from 'zwiebelfisch';

createEditor(host, {
  source,                                    // seeds a new room; a room's text wins
  user: { name: 'Ada', color: '#6c71c4' },   // the name until signed in; color optional
  extensions: (builtinExtensions) => [
    ...builtinExtensions,
    collaboration({ url: 'wss://editor.example.org', room: 'project-42' }), // the WebSocket: <url>/api/collaboration
  ],
});
```

On `<zwiebelfisch-editor>`, put `extensions` and `user` into `options` before the element connects.

== Connections <configuration-collaboration-server-connections>

`collaboration(…)` takes one of:

- *`{ url, room }`*: this repository's server (@configuration-collaboration-server-running), which speaks the #link("https://tiptap.dev/docs/hocuspocus")[Hocuspocus] protocol and lets in only people signed in there (@configuration-collaboration-server-sign-in). `url` is the server's URL (a path prefix allowed); the widget connects to `<url>/api/collaboration`. The page must be on the server's host (any port): the session cookie goes along to the WebSocket and the room's files. Signed out, the widget does not connect: it offers to sign in. The status bar shows the account: "Sign in", or the user's name with "Sign out" in its menu (commands `collaboration.signIn`, `collaboration.signOut`); others see the signed-in name.
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
  [`ZWF_ADDRESS`], [The interface to listen on (default `127.0.0.1`; `0.0.0.0` in a container).],
  [`ZWF_COLLAB_DB`], [The SQLite file (default `server/.data/collab.sqlite`; `:memory:` keeps nothing).],
  [`ZWF_PLAIN_ROOMS`], [`1`: also open plain rooms, to anyone signed in. Default off: a client asking for one is refused, and the widget says why.],
  [`ZWF_AUTH_…`], [The sign-in, required (@configuration-collaboration-server-sign-in).],
  [`ZWF_LOG_LEVEL`, `ZWF_LOG_FORMAT`], [`debug` … `error` (default `info`); `console` (default) or `json`.],
)

A server without sign-in, or with neither GitLab nor plain rooms, does not start. Only `/api/public/…` answers without signing in (@architecture-server-routes); behind a reverse proxy, forward every path. `GET /api/public/info` answers `{"plainRooms": true|false}`, for clients to offer only rooms that work.

=== Sign-in <configuration-collaboration-server-sign-in>

People sign in with an #link("https://openid.net/specs/openid-connect-core-1_0.html")[OpenID Connect] provider, by default the GitLab instance (@configuration-gitlab-integration): register an application there (GitLab: _Edit profile → Applications_, or an instance or group application), confidential, with the callback URL `https://<server>/api/public/auth/callback` and the scopes `openid profile email read_api`.

#table(
  columns: 2,
  [Variable], [Meaning],
  [`ZWF_AUTH_CLIENT_ID`], [Required: the application's id.],
  [`ZWF_AUTH_CLIENT_SECRET`], [Required: its secret (never commit it).],
  [`ZWF_AUTH_REDIRECT_URL`], [The callback registered with the application, e.g. `https://editor.example.org/api/public/auth/callback`. Default: `/api/public/auth/callback` on the host the browser named.],
  [`ZWF_AUTH_ISSUER`], [The provider (default `ZWF_GITLAB_URL`). Another one signs people in, but GitLab rooms refuse them: their GitLab account is unknown.],
)

- The server keeps who signed in in memory, with the user's tokens: nothing of it is stored. A restart signs everyone out; a sign-in lasts 7 days otherwise.
- The session is a cookie (httpOnly, SameSite=Lax; Secure unless the host is `localhost` or a loopback address: serve the editor over HTTPS). Requests from other sites' pages are nobody's.
- Endpoints: `GET /api/public/auth/login?return=<url>` (back to `<url>` afterwards, a URL of the same host), `GET /api/public/auth/callback`, `POST /api/auth/logout`, `GET /api/me` (who is signed in, or 401).

== Trying it locally <configuration-collaboration-server-demo>

`mise run demo` starts the demo with a server whose GitLab is an in-memory fake (@getting-started-demo).

- *GitLab (fake):* pick it, or open `?room=gitlab:demo/report@main`. Another branch name starts a fresh branch from `main`.
- *Sign in* with the status bar's "Sign in": the fake GitLab asks for a name (anyone, no password). A second user is a private window, signed in as someone else.
- *Collaborate:* a plain room (the playground server enables them; the bar offers it once the server says so).
- "Simulate upstream commit" pushes a change to the fake repository, to try merges and conflicts.
- `curl -X POST 'http://localhost:1234/playground/outage?room=gitlab:demo/report@main'` makes the fake GitLab unreachable (`&on=false` ends it).
- Restart `mise run demo` to reset the fake repository.
