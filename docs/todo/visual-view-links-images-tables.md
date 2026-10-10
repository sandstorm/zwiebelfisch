# Visual view v3: links, images, tables, compiled raw boxes

Status: open
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
