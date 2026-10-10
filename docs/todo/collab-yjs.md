# Collaboration: Y.Text-backed TypstDocument + Hocuspocus

Status: done (branch task/collab-yjs)
Depends on: visual-view-projection (to keep the projection's assumptions honest)
Touches: src/document/**, src/source-view/**, src/collab/** (new), src/editor/**, server/** (new)

## Goal
Real-time co-editing. `TypstDocument` gets a `Y.Text` backend with an unchanged interface;
CodeMirror binds via `y-codemirror.next` (or keeps going through TypstDocument); remote cursors
via awareness; a Hocuspocus server (Node) in `server/`. ProseMirror never syncs directly.

## Acceptance
vitest: two Y.Docs converge through TypstDocument edits from both views; e2e with two pages
against a local server (user-run).

## Outcome
- `TypstDocument.fromYText` / `share(ytext)`; remote edits arrive with `REMOTE_ORIGIN`. No
  y-codemirror binding: CodeMirror keeps going through TypstDocument.
- `src/collab`: `SharedProject` (`files`: Y.Map<path, Y.Text>), `SharedComments` (`comments`:
  Y.Map, relative-position anchors), `RemoteCursors` (awareness → highlight layers),
  `Collaboration` (Y.Doc or Hocuspocus room). Widget option `collaboration`, `user.color`.
- Undo: per-view history, remote edits excluded (no Y.UndoManager); see ARCHITECTURE.md.
- `server/`: Hocuspocus 4.7.0, SQLite storage extension point, token hook stub;
  `mise run server:dev` / `server:test`.
- Tests: `src/collab/*.test.ts` (in-process Y.Docs, both views in jsdom), `server:test`
  (in-process Hocuspocus); `tests/e2e/collab.spec.ts` via `mise run test:e2e-collab` (user-run).
