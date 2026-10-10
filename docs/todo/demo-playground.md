# Demo playground (everything checkable standalone, with a fake GitLab)
Status: done (branch task/demo-playground)
Depends on: demo-examples, collab-yjs, server-gitlab
Touches: demo/**, server/src/playground/**, server/src/fake-gitlab-main.ts, server/src/collab-server.ts,
server/src/gitlab/{http,fake-gitlab,gitlab-extension}.ts, mise-tasks/demo, tests/e2e/{demo-playground,gitlab}.spec.ts,
docs/demo-playground.md

## Goal
Every user-visible feature can be tried by one person on one machine without a real GitLab,
secrets or network (only localhost):
- `mise run demo` starts the demo and the collaboration server with the in-memory fake GitLab,
  prints the URLs, and Ctrl-C stops both (`mise run dev` keeps working alone);
- the demo's bar becomes a playground: example, mode (Local / Collaborate / GitLab (fake)), user
  name, "open a second window as another user", server status with the command to start it
  (instead of silently staying local);
- the fake GitLab project is the advanced example (multi-file + images), and an upstream commit
  can be simulated from the bar so the merge (and conflict) flow can be checked by hand;
- a feature checklist with exact steps: docs/demo-playground.md.

## Context
- The fake GitLab server (server/src/fake-gitlab-main.ts) already served plain rooms too (any
  room name that is not `gitlab:…`), so one server covers both modes on port 1234.
- The static e2e build (tests/e2e/fixtures.ts) must keep working without a server: Local mode is
  the default and never contacts one.

## Acceptance
- vitest: playground URL/state handling (`demo/playground.test.ts`), server probe / upstream call
  / status texts (`demo/server-status.test.ts`), the bar (`demo/playground-bar.test.ts`, jsdom),
  the upstream-simulation endpoint in-process (`server/src/playground/playground.test.ts`).
- Playwright (not run in the sandbox): `tests/e2e/demo-playground.spec.ts` (bar in Local mode,
  unreachable server, stubbed playground endpoint), `tests/e2e/gitlab.spec.ts` adapted to the
  richer project plus an upstream-merge test.

## Out of scope
- A connection status API on the widget (the bar probes the server over HTTP instead).
- Configurable ports for the demo page (fixed 5199 / 1234, as before).

## Outcome
- `mise-tasks/demo`: starts `node server/src/fake-gitlab-main.ts`, waits for :1234 (fails early
  if the port is taken), prints Local / Collaborate / GitLab URLs, runs Vite; an EXIT trap stops
  the server.
- Server: `server/src/playground/` — `playgroundOptions(fakeGitLab, { appendTo })` (GitLab
  rooms with a webhook secret + `PlaygroundEndpoints`), endpoints `GET /playground`
  (`{project, room}`) and `POST /playground/upstream?room=…&change=append|heading` (commits to
  the fake branch, then delivers the push webhook through the GitLab extension, so open rooms
  merge or report a conflict); `readProjectFiles(dir)` loads `demo/examples/advanced` into the
  fake repository. `CollabOptions.extensions` adds extensions; `http.ts` now owns the Node
  request/response adapters; `FakeGitLab.push` on a new branch starts at `main` with
  `autoBranches`, `hasBranch()`.
- Demo: `demo/playground.ts` (state ↔ URL: `example`, `room` → mode, `user`, `changes`;
  `editorOptions(state, server)`), `demo/server-status.ts` (`probeServer` → gitlab / plain /
  offline, `simulateUpstream`, `describeServer`), `demo/playground-bar.ts` (DOM). In a room
  without `?user` the page puts `user=Ann` into the URL. GitLab mode passes no local files (the
  repository wins); without a server a room falls back to a local copy and says so; the bar
  re-probes every 5 s ("lost" / "reload"). `?changes` ("Track changes") sets the example as the
  base, so "Show changes" can be tried outside GitLab rooms (off by default; e2e unaffected).
- The GitLab e2e spec now expects the advanced example (`chapters/introduction.typ`, "Goals").
- Needs a browser / ports (not run here): `mise run demo` by hand, `mise run test:e2e`
  (demo-playground.spec and the existing specs with the new bar), `mise run test:e2e-gitlab`,
  `mise run test:e2e-collab`.
