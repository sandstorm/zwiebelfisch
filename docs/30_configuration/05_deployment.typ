#import "../template.typ": mermaid, unreviewed

= Deployment <configuration-deployment>

#unreviewed

The Docker image `ghcr.io/sandstorm/zwiebelfisch` (`:main` follows the main branch, `:1.2.3` a release) is the collaboration server (@configuration-collaboration-server) with the app: the start page (@features-start-page) and the editor, on one port. The demo with its fake GitLab is not in it (`mise run demo`, @getting-started-demo).

```sh
docker run -p 1234:1234 -v zwf-data:/data \
  -e ZWF_ALLOWED_ORIGINS=https://zwf.example.org \
  -e ZWF_GITLAB_URL=https://gitlab.example.org \
  -e ZWF_AUTH_CLIENT_ID=… -e ZWF_AUTH_CLIENT_SECRET=… \
  ghcr.io/sandstorm/zwiebelfisch
```

- Serve it over HTTPS behind a reverse proxy that forwards every path; `ZWF_ALLOWED_ORIGINS` names the app's own origin.
- The GitLab application's callback is `https://zwf.example.org/api/public/auth/callback` (@configuration-collaboration-server-sign-in).
- `/data` holds the database and the git clones (`ZWF_COLLAB_DB=/data/collab.sqlite`).
- Every other variable as in @configuration-collaboration-server-running and @configuration-gitlab-integration.
- From a checkout: `mise run docker:build`, then `mise run docker:run` with `ZWF_GITLAB_URL`, `ZWF_AUTH_CLIENT_ID` and `ZWF_AUTH_CLIENT_SECRET` in the environment (e.g. `mise.local.toml`), on `http://localhost:1234/`.

== The app <configuration-deployment-app>

#table(
  columns: 2,
  [Path], [What],
  [`/`], [The start page. It loads no editor.],
  [`/edit?room=gitlab:<project>@<branch>[:/<folder>]`], [The editor in that room. A guest link opens here.],
  [`/api/…`], [The server (@configuration-collaboration-server-running).],
)

The server serves the built app (`dist/app`, `mise run build:app`) from `ZWF_WEB_DIST`; the image sets it. The app is its own build (`vite.app.config.ts`): the widget's npm package (`dist/lib`) has none of it, and the start page loads no editor.

To work on it: `mise run server:dev` and `mise run app` (Vite on `http://127.0.0.1:5200/`, `/api` passed on to the server, so the session is the page's own). The GitLab application's callback is then `http://127.0.0.1:5200/api/public/auth/callback`.

== What the start page asks <configuration-deployment-endpoints>

All signed in. GitLab is asked with the user's token (`read_api`).

#table(
  columns: 2,
  [Endpoint], [Answer],
  [`GET /api/me/rooms`], [Pinned (own and the team's), recent (at most 50) and open rooms, each with who is in. Only rooms the user may open.],
  [`PUT`, `DELETE /api/me/rooms/<room>/pin`], [Pin or unpin for the user.],
  [`PUT`, `DELETE /api/rooms/<room>/team-pin`], [Pin or unpin for the team: Maintainers of the project.],
  [`DELETE /api/me/rooms/<room>`], [Off the recent list.],
  [`GET /api/gitlab/projects?search=`], [Projects the user may edit (Developer or more).],
  [`GET /api/gitlab/projects/<project>/branches?search=`], [Branches.],
  [`GET /api/gitlab/projects/<project>/folders?ref=`], [Project folders (with a `main.typ`, not starting with `_`) and the templates (@features-start-page-new-project).],
  [`POST /api/gitlab/projects/<project>/folders {ref, path, template}`], [Opens the new folder's room with the template's files as unsaved changes; answers the room.],
)

Recent rooms are stored when a user joins one; nothing else is sent for it. A new folder's files wait in memory until its room first opens (a restart before forgets them). The database keeps per GitLab user id the rooms, when they were last opened and whether pinned, and per room the team pin with who set it. No tokens.

#figure(
  mermaid(read("../diagrams/deployment-new-project.mmd"), width: 80%),
  caption: [A new project: the template's files become unsaved changes of the new room.],
)
