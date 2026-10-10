# Visual view v2: toolbar and raw-box editing

Status: done (branch task/visual-view-toolbar-and-raw-editing)
Depends on: visual-view-projection, tiptap-migration
Touches: src/visual-view/**, src/editor/styles.css

## Goal
Make the Visual view usable for non-technical users: a toolbar (bold, italic, H1–H3, bullet/numbered
list, undo/redo), and raw boxes editable inline with a nested CodeMirror (the ProseMirror "embedded
code editor" example).

Split off into [visual-view-links-images-tables](visual-view-links-images-tables.md): links,
images, simple tables as structured nodes, and raw boxes rendered as compiled snippets. They need
new node types in `projection.ts`, which the position-map task is changing at the same time.

## Result
- `src/visual-view/toolbar.ts`: `Toolbar` (Tiptap-aware), created by `VisualView`. Undo/redo,
  text style menu (Normal text, Heading 1–3), bold, italic, bulleted/numbered list.
- `src/visual-view/raw-box.ts`: a NodeView for `rawBlock` / `rawInline` with a nested CodeMirror
  (edits set `attrs.src`), plus keyboard navigation in and out of boxes.
- `src/source-view/typst-language.ts`: the shared Typst language support for CodeMirror.

## Acceptance
- Unit (jsdom): `toolbar.test.ts`: each toolbar action produces the expected Typst source;
  `raw-box.test.ts`: box edits, outside changes, undo, arrow exit, Backspace delete.
- Playwright: `tests/e2e/visual-toolbar.spec.ts`: one spec per toolbar action asserting the
  resulting Typst source, plus raw-box editing and navigation (needs a user run: `mise run test:e2e`).
- Round-trip invariant still holds (`projection.test.ts` is unchanged and passes).

## Known gaps
- While a raw box has focus, the toolbar acts on the outer editor's last selection.
- A raw box edited into modelled Typst (e.g. `= Heading`) stays a raw box until the text is
  re-projected (for example after an edit in the Source view).
