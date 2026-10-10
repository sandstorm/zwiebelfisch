# Projection: precise source offset ↔ ProseMirror position mapping

Status: done (branch task/projection-position-map)
Depends on: tiptap-migration (do it on the Tiptap schema)
Touches: src/visual-view/projection.ts (+ tests)

## Goal
A two-way map between source offsets (UTF-16) and ProseMirror positions at *inline* precision,
not just "which top-level block". Prerequisite for comments, diff rendering, cursor → preview
from the Visual view, and preview click → exact caret in the Visual view.

## Context
- Pristine nodes know their `src`; inside a paragraph, text nodes map 1:1 except where syntax
  is hidden (delimiters `*`/`_`, escapes via the `source` mark, soft/hard breaks, raw atoms).
- Approach: during `print`, emit a sorted list of segments `{srcFrom, srcTo, pmFrom, pmTo, kind:
  'text'|'atom'|'syntax'}`; map offsets by binary search; offsets inside hidden syntax snap to
  the nearest visible position.
- Expose as one function pair (e.g. `sourceToPos(doc, offset)`, `posToSource(doc, pos)`) —
  keep the segment table private.

## Acceptance
Property test: for random offsets in fixtures, `posToSource(sourceToPos(o))` lands on the same
visible character; mapping is monotonic.
