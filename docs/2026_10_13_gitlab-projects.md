# GitLab projects: sign-in, project chooser, server language (concept, 2026-10-13)

Temporary working note. Distill into the Typst docs (20_features/12_gitlab, 30_configuration/04, 40_architecture/13
and 15 "Open work") and delete once built. Legend: (v) verified in code or on the web today, (r) recalled, check before relying on it.

## 1. Today

| What | How (v) |
|---|---|
| Project identity | Only the room name, chosen by the client: `gitlab:<project id or path>@<branch>` (`server/src/gitlab/gitlab-extension.ts: parseRoomName`). Always the whole repository; no subfolder. |
| Demo "GitLab (fake)" | `?room=gitlab:demo/report@main` in the URL (`demo/playground.ts`, `GITLAB_ROOM`). `FakeGitLab` is in-memory (`server/src/gitlab/fake-gitlab.ts`); another branch name starts a fresh branch from `main`. The playground bar switches modes. |
| Auth | Stub: `sharedToken(TYPST_COLLAB_TOKEN)`, one token for every room and user (`server/src/auth.ts`). Users are whatever name the client sends (`?user=Ann`). |
| GitLab access | One server-wide token with `api` scope (`TYPST_GITLAB_TOKEN`) does everything: tree, files, blobs, commits (`gitlab-api.ts`). Users never sign in to GitLab; commits name co-editors as `Co-authored-by:`. |
| Persistence | SQLite: one Y.Doc per room, GitLab rooms included (`collab-server.ts`, `@hocuspocus/extension-sqlite`). Browser: localStorage/sessionStorage mementos for UI state (`hosts/workbench/memento`). Nothing per user on the server. |
| Main file | GitLab rooms: per user (the client's `mainFile` option); other rooms share it (`project` map, `shared-main-file.ts`). |
| Widget side | `collaboration` extension; GitLab branch shown via the `scm` API → `source-control` extension (status bar "Not in GitLab: …", "Save to GitLab…", M/A decorations). |
| Server size | 26 files, ~2930 lines incl. ~1010 test lines; `gitlab-room.ts` (398) is the largest. Deps: Hocuspocus 4.7, yjs, node-diff3. Shares `src/core/room-protocol/` with the widget. |
| Open work | 15_development.typ: "Auth: GitLab sign-in, a real token check in `onAuthenticate`, the commit author from the verified identity"; "Server: a Rust (`yrs`) or Go server is an open question". |

So there is no "project" concept, no sign-in and no chooser: a real deployment needs the embedding app to know the room name.
The feature sentence ("A project can be a branch of a GitLab repository…") describes the mechanism, not what a user does.
Proposed rewrite: *"Sign in with GitLab and open a repository, or a folder in it, as a project. Everyone who opens it
edits together; "Save to GitLab…" makes a commit."*

## 2. UX

### What IntelliJ IDEA does (r)

- Welcome screen: search field over recent projects; buttons New Project / Open / Get from VCS; recent list with a
  coloured initials icon, name, path, current branch; groups; context menu Remove from Recent, Open in New Window.
- Get from VCS: providers on the left (Repository URL, GitHub, GitLab…); GitLab: log in once (token or OAuth), then a
  filterable list of the account's repositories, then the target directory.
- In a project: main toolbar (new UI) has a project widget (name ▾ → recent projects, Open…, close) and a branch widget
  (⎇ main ▾ → checkout, new branch). File → Open Recent; File → Close Project returns to the welcome screen.

Take: recents first with search, remove from recents, pinning ("groups" no: overkill), "Get from VCS" = "Open from GitLab",
project + branch widgets while editing. Leave out: clone directory (nothing is cloned), multiple VCS providers, new project.

### Flow

```
editor base URL ──no session──▶ GitLab OAuth (authorize, consent once) ──▶ callback ──▶ Welcome
Welcome ──pick recent──────────────────────────────────────────────▶ editor at the project URL
Welcome ──Open from GitLab… ─▶ repository ─▶ (branch, default preselected) ─▶ folder ─▶ main file ─▶ editor
project URL (shared link) ──no session──▶ OAuth ──▶ back to that URL ──access check──▶ editor
```

### Welcome screen

```
┌──────────────────────────────────────────────────────────────────────┐
│ Typst Editor                                   Ada Lovelace ▾ (Sign out)
│                                                                      │
│  [ Search projects…                           ]  [ Open from GitLab… ]│
│                                                                      │
│  Pinned                                                              │
│  TH  thesis                  group/thesis · ⎇ main · /        ✕      │
│  Recent                                                              │
│  RE  report / chapters       demo/report · ⎇ draft · /chapters  ✕    │
│  PA  paper                   ada/paper · ⎇ main · /               ✕  │
│      (missing access: greyed, "No access anymore" on hover)          │
└──────────────────────────────────────────────────────────────────────┘
```

### Open from GitLab (one dialog, three steps, each a filtered list)

```
 Open from GitLab ─────────────────────────────── step 1/3
 [ thes                                    ]   ← server-side search (GitLab ?search=)
   group/thesis           Thesis of Ada · updated 2 h ago
   group/thesis-template  …
   (more on scroll: next page)

 group/thesis ─────────────────────────────────── step 2/3   Branch: [ main ▾ ]
 [ Filter folders                          ]
   /  (whole repository)            3 .typ files
   /chapters                        12 .typ files
   /slides                          1 .typ file
   (only folders that contain .typ files, from one recursive tree call)

 group/thesis /chapters ──────────────────────── step 3/3
   Main file:  ● main.typ   ○ appendix.typ      [ Open ]
```

Branch is a dropdown in step 2, default branch preselected; "New branch…" lives in the in-editor branch picker, not
here. Step 3 is skipped when the folder has one candidate (a `.typ` that no other file includes) or a remembered choice.

### Open from a GitLab URL (user, 2026-10-13)

The welcome screen's search field (and step 1 of "Open from GitLab") also takes a pasted GitLab URL and opens it
directly, everything discovered from it:

| Pasted | Opens |
|---|---|
| `https://gitlab.example.com/group/thesis` | repo, default branch, root folder |
| `…/group/thesis/-/tree/review/chapters` | branch `review`, folder `chapters/` |
| `…/group/thesis/-/blob/main/chapters/intro.typ` | branch `main`, folder `chapters/`, main file `intro.typ` (if `.typ`) |
| `git@gitlab.example.com:group/thesis.git`, `https://…/thesis.git` | as the repo URL |
| an MR URL `…/-/merge_requests/12` | its source branch (API: `merge_requests/:iid`) |

- The server resolves it (`GET /api/projects/:path`, then the ref and path; a branch name with `/` is ambiguous in
  `-/tree/a/b/c`: try the longest ref that exists, as GitLab itself does) and answers repo name, branch, folder,
  main file — or why not (no access, not found, another instance).
- The project's name is the repo's name (GitLab `name`), its folder shown after it (`thesis › chapters`).
- Our own project URLs mirror GitLab's (`/group/thesis/-/tree/main/chapters`), so a GitLab URL with the editor's
  host swapped in works too.

### In the editor ("reflect in the UI")

```
 status bar: [ thesis ▾ ][ ⎇ main ▾ ][ /chapters ]  Not in GitLab: 3 files · 14 min (Ann, Bob)   …   Ada ▾
 tab title:  main.typ — thesis/chapters (main)
```

- `thesis ▾` → quick pick: recent projects, "Open from GitLab…", "Show all projects" (welcome), "Remove … from recents".
- `⎇ main ▾` → quick pick of branches (search), "New branch from main…". Switching = navigating to another project URL.
- `Ada ▾` → "Sign out" (ends the session, back to the welcome screen), "Open in GitLab".
- The existing source-control status sits right of it, unchanged.

### Reused controls (v: they exist and are public)

| Need | Existing control |
|---|---|
| Recent / branch / repository pickers in the editor | `window.showQuickPick` (accepts `Promise<items>`; label/description/detail) |
| Projects in ⌘-search-everywhere | `window.registerSearchProvider` (a "Projects" group) |
| Project + branch widgets | `window.registerStatusBarItem` |
| Commands (Open Recent, Switch Branch, Sign Out) | `commands.registerCommand`, menus |
| Progress while GitLab answers | `window.withProgress` |
| Uncommitted / save | `source-control` extension as is |

Missing: a quick-pick item button (✕ remove from recents; VS Code has `QuickPickItem.buttons`) and multi-step titles
("1/3"). The welcome screen itself has no widget equivalent (the widget needs a project to exist); it is plain app-shell
HTML using the widget's CSS tokens, with the same list styling as the quick input.

## 3. Architecture

### Who does what

| Part | Responsibility | Why there |
|---|---|---|
| Widget `src/` | unchanged mechanism: `collaboration({ url, room, token })`, `mainFile`, `scm`, quick input, status bar | It is embeddable in others' apps, which have their own sign-in and project model. No GitLab sign-in or chooser in it. |
| App shell (new `app/`, beside `demo/`) | routes, welcome screen, OAuth redirect, an extension `projects` (status bar widgets, commands, search provider) | Policy of one product. Like `demo/` but production; the demo's "GitLab (fake)" mode becomes this app against the fake GitLab. |
| Server `server/` | OAuth confidential client, sessions, GitLab proxy for the chooser, recent projects, rooms with an access check, serves the app | Holds the tokens; must check access per room anyway. |

### Project identity

Project = (GitLab instance, repository, branch, folder). The instance is the server's (one per deployment). The user
said "repo + subfolder": branch is still part of identity (two branches are two different sets of files and commits),
but it defaults to the default branch and is chosen in a dropdown, not a step.

- URL, mirroring GitLab's own so a GitLab link converts by swapping the host:
  `https://editor.example.org/group/thesis/-/tree/main/chapters#main.typ:12`
  (path = project path, `-/tree/<branch>/<folder>`; the fragment = open file and line, as `demo/open-file-hash.ts`).
  Branches with `/` are ambiguous as in GitLab; resolve like GitLab (longest existing branch prefix) or encode `/` in
  branch names as `%2F` (simpler; choose the latter).
- Room name: `gitlab:<project path>@<branch>:<folder>` with each part `encodeURIComponent`-ed. One Y.Doc per project.
  `GitLabRoom` reads the tree under `<folder>` and maps paths (`/chapters/a.typ` ↔ room `/a.typ`); commits touch only
  that folder. Two projects with overlapping folders on the same branch are two rooms; each sees the other's commits as
  upstream changes (webhook merge, existing). Acceptable; the chooser could warn.
- Main file: per user, stored in the recent-projects entry, passed as the `mainFile` option (as today).
- Shared with co-authors by sending the URL; they need their own GitLab access.

### OAuth

Choice: **confidential client on the server** (authorization code flow, plus PKCE as GitLab allows (r)), session in an
httpOnly SameSite=Lax cookie; tokens never reach the browser.

| | Server-side code flow (chosen) | SPA + PKCE |
|---|---|---|
| Token location | server (SQLite, encrypted at rest) | browser (XSS-exposed) |
| Room access check / commits as the user | server has the token | browser would have to hand it to the server anyway |
| Auto-commit after everyone left | possible with a stored token | impossible |
| Cost | `/auth/login`, `/auth/callback`, `/auth/logout`, sessions table | none server-side, but all of the above problems |

- Scopes: `read_user` (identity) + `api`. Creating commits via the REST Commits API needs `api`; `write_repository`
  covers only git over HTTP (r). `read_api` alone suffices for the chooser. Ask the user (open question 3).
- Refresh: GitLab access tokens expire after 2 h and come with a rotating refresh token (r); the server refreshes on 401
  or before expiry, per session.
- WebSocket: the app is served by the same origin, so the upgrade carries the cookie; Hocuspocus `onAuthenticate`
  reads the session from the request headers (no token in the client). Cross-origin embedders keep `token` (a short-lived
  ticket from `POST /api/rooms/<room>/ticket`).
- Access check on join: `GET /projects/:id` with the user's token; `permissions` access level ≥ Developer (30) edits,
  Reporter (20) could later open read-only, else refuse. Re-checked on reconnect and implicitly on save (commits use
  the saving user's token, so GitLab enforces protected branches).
- Commit author: the user who saves (their token, real identity) — this closes the "Auth" open item. Auto-commit: the
  token of whoever edited most and still has a valid session; else stays uncommitted and the status bar says so. A
  service token (today's `TYPST_GITLAB_TOKEN`) becomes optional (webhooks, fallback; open question 4).
- Server endpoints for the chooser (thin GitLab proxies, paginated): `GET /api/me`,
  `GET /api/projects?search=&page=` (→ `/projects?membership=true&min_access_level=30&order_by=last_activity_at&simple=true`),
  `GET /api/projects/:id/branches?search=`, `GET /api/projects/:id/folders?ref=` (recursive tree → folders with `.typ`),
  `GET|PUT|DELETE /api/recent` (pinned, main file, last opened).
- Recent projects: on the server per GitLab user id (follows the user across devices; the server has SQLite and the
  identity anyway). localStorage would be zero server work but per browser; not chosen.

## 4. Server language

What the server must do: WebSocket Yjs sync (Hocuspocus protocol, the widget's provider), **edit Y.Docs itself**
(merges written as minimal `Y.Text` edits, `meta` map), GitLab REST + OAuth, 3-way line merge, SQLite, serve static
files. Typst compile happens in the browser (wasm worker); server-side compile is not planned.

| | Node/TS (today) | Rust | Go |
|---|---|---|---|
| Yjs | reference implementation; Hocuspocus 4.7 mature | `yrs` from the y-crdt project (Yjs authors' org) (r); servers: `yrs-axum`, `yrs-tokio`, `hocuspocus-rs`, y-sweet (v: exist) | several 2025–26 third-party ports claiming byte compatibility and Hocuspocus-compatible servers: reearth/ygo, Deln0r/ygo, CivNode/yjs-go, antst/go-yjs (v: exist; maturity unverified) |
| Shares `src/core/room-protocol/` with the widget | yes, imported | no: duplicate names/types (drift risk) | no: duplicate |
| 3-way merge | node-diff3 | `diffy` has merge (r) | uncertain (r) |
| Typst server-side later | via the wasm engine | `typst` crate natively; repo already builds Rust (`build:engine`) | no |
| Deploy | Node runtime image (today's Dockerfile) | single static binary | single static binary |
| Footprint / perf | fine for I/O-bound rooms | best | very good |
| Team | same language as the widget and tests | Rust exists in repo (engine) | new language in repo |

Recommendation: **stay on Node/TypeScript now**; build sign-in and the chooser there. Reasons: the server is small and
I/O-bound, it manipulates Y.Docs (so the reference Yjs avoids subtle encoding/merge differences), it shares the room
protocol with the widget, and its tests run the real Hocuspocus in-process (`gitlab-rooms.test.ts`, 561 lines).
If it moves, move to **Rust, not Go**: `yrs` is maintained by the Yjs ecosystem, the repo already has a Rust toolchain,
and the `typst` crate would enable server-side PDF/preview. Triggers to revisit: server-side compile, memory per room
at scale, or a single-binary on-prem requirement.
Migration cost (estimate): ~1900 non-test lines to rewrite (GitLab room, merge, commit actions, editors, HTTP), the
room protocol duplicated, ~1000 test lines re-done; e2e specs stay (same wire protocol). Roughly 1–2 weeks of agent
work plus a period of running both against the e2e suite.

## 5. Plan (each step testable)

(Pasting a GitLab URL belongs to step 4's dialog; its resolver to the server step that lists projects.)

1. **Server sign-in**: OAuth endpoints, sessions table, `Authenticate` from the session cookie, `/api/me`.
   `FakeGitLab` gains `/oauth/authorize|token` and `/api/v4/user`. Test: server tests with the fake; e2e sign-in.
2. **Chooser API**: `/api/projects`, `/branches`, `/folders`, `/recent` against the fake. Test: unit tests per endpoint.
3. **Folder rooms**: room name with folder; `GitLabRoom` path mapping and folder-scoped commits; access check on join
   with the user's token; commits as the saving user. Test: `gitlab-rooms.test.ts` cases for folder + permission refused.
4. **App shell `app/`**: routes (`/`, `/<path>/-/tree/<branch>/<folder>`), welcome screen, Open from GitLab dialog,
   server serves it (SPA fallback). Test: e2e on the fake GitLab (`test:e2e-gitlab`).
5. **`projects` extension** in the app shell: status bar project/branch widgets, commands, search provider, sign out.
   Widget additions only if needed: quick-pick item buttons. Test: unit + e2e.
6. **Demo + docs**: the demo's "GitLab (fake)" mode opens the app shell; rewrite 20_features/12_gitlab,
   30_configuration/04 (OAuth app id/secret, redirect URL, scopes), 40_architecture/13; remove the open items.

## Open questions

1. Branch: part of the project (dropdown, default preselected), as proposed — or always the default branch?
2. Recent projects on the server per user (proposed) or in the browser only?
3. Scope `api` (needed for REST commits, broad) acceptable, or commit with a service token and use `read_api` for users?
4. Auto-commit when nobody is signed in any more: skip (proposed) or a service token?
5. One GitLab instance per deployment (proposed), or several (instance in the URL)?
6. Language: stay on Node now and revisit with server-side compile (proposed), or switch to Rust now?
