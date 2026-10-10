# Visual view: text alignment

Status: done (branch task/visual-text-align)
Depends on: visual-view-toolbar-and-raw-editing, projection-position-map
Touches: src/visual-view/{alignment,text-align}.ts (new), small hunks in projection.ts, toolbar.ts, extensions.ts

## Goal
Align paragraphs and headings in the Visual view like TipTap's TextAlign extension: toolbar
buttons left / center / right / justify and the shortcuts Mod-Shift-L/E/R/J, written back as
idiomatic Typst with minimal source edits.

## Context
TipTap's TextAlign stores a `textAlign` attribute per textblock; Typst has no such attribute.
Alignment is a block-level wrapper (`#align(center)[..]`) or a set rule (`#set align(..)`), and
justification is a paragraph property (`#par(justify: true)[..]`, `#set par(justify: true)`).
`#par(..)[..]` must hold a single paragraph (Typst ignores parbreaks inside it, with warnings).

## Acceptance
vitest: projection round-trips (align wrapper around paragraphs, headings, lists; vertical and
nested alignments; unusual arguments raw), commands produce the expected minimal text,
toggling back removes the wrapper, set-rule awareness, one undo step. Playwright spec.

## Out of scope
Right-to-left text (`start`/`end` are read as left/right); per-line alignment inside a paragraph;
merging a new wrapper with an adjacent one of the same alignment; justifying list items.

## Outcome
- Mapping:
  - `#align(<literal>)[blocks]` is an `alignment` block holding editable blocks. The
    literal is `left|center|right|start|end`, optionally combined with one vertical
    alignment (`top + center`). Its `args` are kept as written and only the horizontal part is
    edited.
  - `#par(justify: true|false)[inline]` is a paragraph with a `justify` flag.
  - Anything else (`#align(center, [..])`, variables, other `par` arguments, parbreaks inside
    `#par[..]`) stays a raw block.
  - Pristine alignment blocks print the source around their blocks verbatim (like tables).
    A changed alignment re-prints only `#align(args)`. New ones print `#align(x)[A\n\nB]`.
- Commands (`setTextAlign`, `unsetTextAlign`; one transaction each):
  - center/right on blocks outside a wrapper wraps the selected blocks in one alignment block
    and merges plain wrappers inside the selection.
  - Covering a whole wrapper changes its argument, or removes the wrapper when the new value
    equals the surrounding alignment. A partial selection splits it.
  - Justify removes horizontal wrappers and flags the selected paragraphs; headings and list
    items are left alone. Left/center/right clear the flag.
- Set rules: `#set align(..)` / `#set par(justify: ..)` in a raw block apply to the following
  blocks in the same container. The Visual view shows the effective alignment (CSS
  `text-align` decorations), the buttons follow it, and commands only write what differs
  from it (e.g. `#par(justify: false)[..]` under a document-wide justify).
- Tests: `alignment.test.ts`, `text-align-projection.test.ts`, `text-align.test.ts` (jsdom,
  toolbar and shortcuts); Playwright `tests/e2e/visual-text-align.spec.ts` (needs
  `mise run test:e2e`, not run in the sandbox).
