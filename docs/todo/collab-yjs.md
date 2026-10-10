# Collaboration: Y.Text-backed TypstDocument + Hocuspocus

Status: open (later)
Depends on: visual-view-projection (to keep the projection's assumptions honest)
Touches: src/document/**, src/source-view/**, server/** (new)

## Goal
Real-time co-editing. `TypstDocument` gets a `Y.Text` backend with an unchanged interface;
CodeMirror binds via `y-codemirror.next` (or keeps going through TypstDocument); remote cursors
via awareness; a Hocuspocus server (Node) in `server/`. ProseMirror never syncs directly.

## Acceptance
vitest: two Y.Docs converge through TypstDocument edits from both views; e2e with two pages
against a local server (user-run).
