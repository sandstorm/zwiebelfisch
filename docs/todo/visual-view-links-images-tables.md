# Visual view v3: links, images, tables, compiled raw boxes

Status: done (branch task/visual-view-links-images-tables) — compiled raw boxes and image
rendering split off into [visual-view-compiled-boxes](visual-view-compiled-boxes.md)
Depends on: visual-view-toolbar-and-raw-editing, projection-position-map
Touches: src/visual-view/** (incl. new node types in projection.ts), src/preview (snippet compile)

## Goal
- **Links** (`#link("url")[text]`, bare URLs) as a Tiptap link mark with a toolbar button and
  a small edit popover.
- **Images** (`#image("path")`) as an image node; needs the multi-file asset wiring.
- **Simple tables** (`#table(columns: n, [..], ..)`) as structured table nodes (Tiptap's MIT
  table extensions); anything beyond plain cells stays a raw box.
- **Raw boxes rendered as compiled snippets** where possible (e.g. display math): show the
  compiled SVG when the box is not focused, and the code when it is.

## Context
Split off from [visual-view-toolbar-and-raw-editing](visual-view-toolbar-and-raw-editing.md).
New node types need project/print support in `projection.ts`, so this follows the position map.
Only free/MIT Tiptap extensions.

## Acceptance
Unit tests for project/print round-trips of each new construct; Playwright specs per toolbar
action asserting the resulting Typst source.

## Outcome
- Links: `#link("url")[text]` (plain string, single-paragraph text) and bare URLs project to
  Tiptap's `link` mark. Edited text prints `#link("url")[..]`, or a bare URL where Typst reads it
  back as the same link. Toolbar "Link" button / Mod+K opens a popover (link selection, edit or
  remove the link under the cursor, insert the URL as linked text).
- Images: a standalone `#image("path", ..)` is an `image` block. Its source is kept verbatim and
  edited like a raw box, headed by "Image: path". "Insert image" asks for a path. The image itself
  is not rendered yet (follow-up).
- Tables: `#table(columns: n, ..named, [..], ..)` with only content-block cells (count a multiple
  of n) is a Tiptap table; cells hold blocks. An edited cell changes only that cell's source; a
  reshaped table is re-printed canonically, keeping its other named arguments. Toolbar: insert
  table, add/delete row/column. Anything else (`columns: (..)`, `table.header`, `table.cell`,
  merged cells) stays raw.
- Tests: projection unit tests (round trips, edits, exhaustive position map incl. new nodes),
  toolbar jsdom tests, Playwright `tests/e2e/visual-links-tables.spec.ts`.
