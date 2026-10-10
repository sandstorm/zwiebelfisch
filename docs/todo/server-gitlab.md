# Server: GitLab load / commit

Status: done (branch task/server-gitlab)
Depends on: collab-yjs
Touches: server/**

## Goal
Hocuspocus `onLoadDocument` seeds Y.Texts from a GitLab repo (tree + raw files API, remember
`baseSha`); "Save version" commits all changed files in one commit (`POST
/projects/:id/repository/commits`, `last_commit_id` for optimistic concurrency); conflict path:
3-way merge applied as minimal Y.Text edits. Assets by reference.

## Acceptance
Integration tests against a mocked GitLab API.

## Outcome
- `server/src/gitlab/`: rooms `gitlab:<project>@<branch>`; load (tree, Files API), Save version
  as one commit (per-file `last_commit_id`: GitLab checks it per action, so a branch-head check
  alone would not protect concurrent pushes), upstream merge (node-diff3, small Y.Text edits),
  conflicts reported (stateless) without touching the text, room files over HTTP (blob cache),
  push webhook. Integration tests: `server/src/gitlab/gitlab-rooms.test.ts` against `FakeGitLab`
  (`mise run server:test`).
- Widget: `RoomVersions`, `SharedAssets` (src/collab), `VersionControls` (src/editor).
- Needs a user run: `mise run test:e2e-gitlab` (Playwright, fake GitLab server on port 1234).
- Protocol and limits: ARCHITECTURE.md (GitLab-backed rooms), docs/embedding.md.
