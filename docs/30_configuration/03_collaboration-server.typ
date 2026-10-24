#import "../template.typ": unreviewed

= Collaboration server <configuration-collaboration-server>

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

- *`{ url, room }`*: this repository's server (@configuration-collaboration-server-running), which speaks the #link("https://tiptap.dev/docs/hocuspocus")[Hocuspocus] protocol and lets in only people signed in there (@configuration-collaboration-server-sign-in). `url` is the server's URL (a path prefix allowed); the widget connects to `<url>/api/collaboration`. The page's origin must be one of the server's `ZWF_ALLOWED_ORIGINS` (@configuration-collaboration-server-running): only then do its requests carry the session to the WebSocket and the room's files. Signed out, the widget does not connect: a card over the whole widget says "You are not signed in" with "Sign in" (also when the session ends, with the reason), and it cannot be closed. The title bar shows the account: "Sign in", or the user's name with "Sign out" in its menu (commands `collaboration.signIn`, `collaboration.signOut`); others see the signed-in name.
- *`{ doc, awareness? }`*: a `Y.Doc` you connected and synced yourself (y-websocket, y-webrtc, …); `awareness` for remote cursors. It must use the editor's Yjs instance, so bundle the editor from source; `dist/lib` has its own copy.

The collaboration code loads on demand. `onDidChangeFiles` and `change` also fire for the others' edits.

== The server <configuration-collaboration-server-running>

`server/` is a Go server that stores rooms in SQLite (@architecture-data-model-collaboration). Its rooms are GitLab folders (@configuration-gitlab-integration); rooms of any other name without a colon (*plain rooms*) only when enabled; a name with a colon (`gitlab:…`) is never a plain room. Run it with:

```sh
mise run server:dev    # ws://127.0.0.1:1234, allowing the demo's pages on :5199
```

#table(
  columns: 2,
  [Variable], [Meaning],
  [`ZWF_ALLOWED_ORIGINS`], [Required: the origins of the pages that embed the editor, comma-separated, each exactly `scheme://host[:port]` (`http` or `https`; no path, no `*`; the host as browsers send it, an international one in punycode `xn--…`), e.g. `https://editor.example.org,https://intranet.example.org:8443`. Only their requests use the session (@configuration-collaboration-server-sign-in). The server's own origin counts only if listed. `mise run server:dev` sets `http://127.0.0.1:5199,http://localhost:5199` unless it is set.],
  [`PORT`], [Default `1234`.],
  [`ZWF_ADDRESS`], [The interface to listen on (default `127.0.0.1`; `0.0.0.0` in a container).],
  [`ZWF_COLLAB_DB`], [The SQLite file (default `server/.data/collab.sqlite`; `:memory:` keeps nothing).],
  [`ZWF_PLAIN_ROOMS`], [`1`: also open plain rooms, to anyone signed in. Default off: a client asking for one is refused, and the widget says why.],
  [`ZWF_GUESTS`], [`1`: members may share a room with guests by a link (@configuration-collaboration-server-guests). Default off.],
  [`ZWF_AUTH_…`], [The sign-in, required (@configuration-collaboration-server-sign-in).],
  [`ZWF_LOG_LEVEL`, `ZWF_LOG_FORMAT`], [`debug` … `error` (default `info`); `console` (default) or `json`.],
)

A server without `ZWF_ALLOWED_ORIGINS` (or with an entry that is not an exact origin), without sign-in, or with neither GitLab nor plain rooms does not start, and says which variable is missing. Only `/api/public/…` answers without signing in; behind a reverse proxy, forward every path. `GET /api/public/info` answers `{"plainRooms": true|false, "guests": true|false}`, for clients to offer only what works. One WebSocket opens at most 16 rooms (names of at most 1024 bytes); the server pings it every 15 s and drops it after 45 s without a message from the client.

=== Sign-in <configuration-collaboration-server-sign-in>

People sign in with an #link("https://openid.net/specs/openid-connect-core-1_0.html")[OpenID Connect] provider, by default the GitLab instance (@configuration-gitlab-integration): register an application there (GitLab: _Edit profile → Applications_, or an instance or group application), confidential, with the callback URL `https://<server>/api/public/auth/callback` and the scopes `openid profile email read_api write_repository` (the last two: GitLab rooms work in the user's name).

#table(
  columns: 2,
  [Variable], [Meaning],
  [`ZWF_AUTH_CLIENT_ID`], [Required: the application's id.],
  [`ZWF_AUTH_CLIENT_SECRET`], [Required: its secret (never commit it).],
  [`ZWF_AUTH_REDIRECT_URL`], [The callback registered with the application, e.g. `https://editor.example.org/api/public/auth/callback`. Default: `/api/public/auth/callback` on the host the browser named.],
  [`ZWF_AUTH_ISSUER`], [The provider (default `ZWF_GITLAB_URL`). Another one signs people in, but GitLab rooms refuse them: their GitLab account is unknown.],
)

- The server keeps who signed in in memory, with the user's tokens (refreshed when they expire): nothing of it is stored. A restart signs everyone out; a sign-in lasts 7 days otherwise. A sign-in on its way keeps nothing on the server: its state is in a cookie sealed with a key made at start.
- The session is a cookie (httpOnly, SameSite=Lax; Secure unless the host is `localhost` or a loopback address: serve the editor over HTTPS). A request is the session's only without an `Origin` (a navigation, not a browser) or with an `Origin` that is exactly one of `ZWF_ALLOWED_ORIGINS` (scheme, host and port; `:443` and `:80` as their scheme's default). Requests from any other page are nobody's: no session, no readable answer, no WebSocket, no guest join. The `Host` the request names plays no part.
- Endpoints: `GET /api/public/auth/login?return=<url>` (back to `<url>` afterwards: a path on the server, or a URL on one of `ZWF_ALLOWED_ORIGINS`), `GET /api/public/auth/callback`, `POST /api/auth/logout`, `GET /api/me` (who is signed in, or 401).
- A sign-out ends that session's open connections: its rooms refuse them ("You signed out."), as they refuse any room opened again on a connection whose session ended; the user's other browsers stay in.

=== Guest access <configuration-collaboration-server-guests>

With `ZWF_GUESTS=1`, a member shares a room with people who have no account (@features-guest-access). Who may share: in a GitLab room who may edit it (@configuration-gitlab-integration), in a plain room anyone signed in; never a guest.

- *Lifetimes:* 1, 7 (default) or 30 days; no longer, no extension (make a new link). At most 10 active links per room.
- *A guest opens one room:* the link's, and its files and history; any other room refuses them ("This guest link is for another project."). A guest is a user of the provider `guest`, named "<name> (guest)"; their session ends with the link.
- *A room's links* are the room's: every member who may share it lists all of them and revokes any.
- *Expiry and revocation* end the link's guest sessions and refuse their clients at once ("Guest access to this project has ended."). Every 10 minutes and at each join, the server asks again whether the link's creator may still share, with the creator's GitLab token, or while they are signed out with that of any signed-in member of the project: one who may not any more loses their links. Only when nobody signed in can ask are the links kept.
- *Restarts:* links are in the database (`shares`), so they survive a restart; guest sessions are in memory, so guests open the link again (their name is offered).
- Endpoints: `POST /api/public/guest/join {token, name}`; signed in, `GET` and `POST /api/rooms/<room>/shares` (`{label, days}`), `DELETE /api/rooms/<room>/shares/<id>`. A change of a room's links or guests reaches its clients as the stateless message `{"type": "guests:changed"}`.

Security:
- The link is `<page URL>#zwf-guest=<secret>` (130 random bits). The secret is in the fragment, which browsers send to no server and put in no `Referer`; the page takes it out of the address bar at once.
- The server keeps only the secret's SHA-256 hash; it never stores or logs the secret. The secret is shown once, when the link is made.
- A join must come from an allowed origin's page as JSON. Every link that does not let in (unknown, expired, revoked) gets the same 404. Joins are limited to 10 a minute per IP address and 100 a minute in all; behind a reverse proxy all count as the proxy's address.
- A guest cannot share, list others' links or revoke, and never saves; in a room of one folder, they cannot load files from outside it either.
- In a GitLab room a guest changes only files ending in `.typ`, `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.webp`, `.mmd` or `.ic` (in any case; clients read the list from the room's `meta.guestEditable`). A guest's change to any other file (edit, create, rename, delete) or to the room's `meta` is undone at once, before any commit can take it, and the guest's client is refused ("Guests may change only Typst files, images, Mermaid diagrams and spreadsheets; your change to another file was undone."). A guest's update that depends on changes the room does not hold yet is refused too, unapplied ("Your change depends on changes this project does not have; open the project again."), so no later change of a member's can complete it.
- A guest's name has no `<`, `>`, control or bidirectional characters, so it cannot hide "(guest)" or name another email in a `Co-authored-by` trailer. The history a guest gets has no emails in its commit messages.

== Trying it locally <configuration-collaboration-server-demo>

`mise run demo` starts the demo with a server whose GitLab is an in-memory fake (@getting-started-demo). Without `ZWF_ALLOWED_ORIGINS` it allows the demo's pages, `http://127.0.0.1:5199` and `http://localhost:5199`.

- *GitLab (fake):* pick it, or open `?room=gitlab:demo/report@main`. Another branch name starts a fresh branch from `main`.
- *Sign in* with "Sign in" on the card over the widget: the fake GitLab asks for a name (anyone, no password). A second user is a private window, signed in as someone else.
- *Collaborate:* a plain room (the playground server enables them; the bar offers it once the server says so).
- *Guests:* the playground server has guest links on; "Share" in the title bar makes one, a private window opens it.
- "Simulate upstream commit" pushes a change to the fake repository, to try merges and conflicts.
- `curl -X POST 'http://localhost:1234/playground/outage?room=gitlab:demo/report@main'` makes pushes to that branch fail as if the fake GitLab were unreachable (`&on=false` ends it).
- Restart `mise run demo` to reset the fake repository.
