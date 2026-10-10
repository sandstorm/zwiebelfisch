# Comments (review annotations)

Status: done (branch task/comments)
Depends on: projection-position-map; collab-yjs for the shared/realtime variant
Touches: src/comments/** (new), src/visual-view/**, src/source-view/**, src/preview/** (margin markers), src/editor/**

## Goal
Word/OnlyOffice-style comments: select text in either view → "Comment" → thread in a side
panel; replies, resolve/reopen, author + time. Commented ranges are highlighted in the Visual
and Source views and marked in the preview margin.

## Design (decide/confirm before building)
- **Comments never go into the Typst source** (would pollute output and git diffs). They live
  beside it:
  - standalone/git: a sidecar file per document, e.g. `main.typ.comments.json` (committed with
    the document, or stored server-side);
  - collaborative: a `Y.Map` in the same Y.Doc.
- **Anchors** must survive edits from any view and from outside:
  - live: Yjs `RelativePosition`s (collab) or offsets mapped through every `TypstDocument`
    change (standalone);
  - persisted: W3C Web Annotation style `{start, end, exact, prefix, suffix}` (TextQuoteSelector
    + position hint) so anchors can be re-attached after the file changed elsewhere (git pull);
    unresolvable anchors become "orphaned" comments shown at the top.
- Rendering:
  - Source view: CodeMirror mark decorations;
  - Visual view: ProseMirror decorations via `sourceToPos`;
  - Preview: `jumpFromCursor` positions → small markers in the page margin.
- Module boundary: one `Comments` deep module owning anchors + storage; views only get
  `ranges()` and events.

## Acceptance
- vitest: anchors move correctly through edits from both views and through `setText`;
  re-anchoring from a TextQuoteSelector after an external edit; orphan detection.
- Playwright: add a comment in the visual view, see it highlighted in source view and marked in
  the preview; resolve it.

## Out of scope
Mentions/notifications; comment permissions (server task).

## Outcome
- Standalone mode is built: `src/comments/` (`Comments`, `anchor.ts`, `CommentsPanel`, `CommentsUI`).
  The widget takes `comments` (JSON), `user: {name}` and `onCommentsChange(json)`. The host
  persists the JSON beside the file. See ARCHITECTURE.md › Review comments and docs/embedding.md §4.
- Hook points added for other features: `setHighlights(layer, …)` on both views,
  `Preview.setMarkers(layer, …)`, `posToSource(doc, pos, -1)` and `selection()` on both views.
- Open: the collaborative variant (`Y.Map` + `RelativePosition`, collab-yjs); a server
  sidecar; comments on files other than the main one (multi-file-ui); editing a posted comment;
  fuzzy re-anchoring when the quoted text itself changed outside the editor (the thread is
  orphaned today).
