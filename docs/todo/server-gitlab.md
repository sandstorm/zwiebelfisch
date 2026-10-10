# Server: GitLab load / commit

Status: open (later)
Depends on: collab-yjs
Touches: server/**

## Goal
Hocuspocus `onLoadDocument` seeds Y.Texts from a GitLab repo (tree + raw files API, remember
`baseSha`); "Save version" commits all changed files in one commit (`POST
/projects/:id/repository/commits`, `last_commit_id` for optimistic concurrency); conflict path:
3-way merge applied as minimal Y.Text edits. Assets by reference.

## Acceptance
Integration tests against a mocked GitLab API.
