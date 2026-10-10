# Visual view v2: toolbar, raw-box editing, links, images, tables

Status: open (after visual-view-projection)
Depends on: visual-view-projection
Touches: src/visual-view/**

## Goal
Make the Visual view usable for non-technical users: toolbar (bold, italic, H1–H3, bullet/numbered
list, undo/redo), raw boxes editable inline with a nested CodeMirror (ProseMirror "embedded
code editor" example), raw boxes rendered as compiled snippets where possible, links, images,
simple tables (`#table`) as structured nodes.

## Acceptance
Playwright specs for each toolbar action asserting the resulting Typst source; round-trip
invariant still holds.
