# Visual view: block nodes modelled on Tiptap's

Status: done (branch task/visual-block-nodes)
Depends on: visual-view-links-images-tables
Touches: src/visual-view/** (projection.ts in small hunks, new files per node in nodes/),
src/editor/styles.css, src/engine/fixtures (cheq), tests/e2e/visual-block-nodes.spec.ts

## Goal
New Visual-view elements modelled on the Tiptap nodes (tiptap.dev/docs/editor/extensions/nodes/*),
each projected from / to Typst with exact round-trip and minimal source edits, with a toolbar
entry and Markdown-style input rules where Tiptap has them:
blockquote, page break, horizontal rule, table header, task list, heading numbering (shown on the
right side; the preview already numbers headings). Code blocks are out of scope here
(task/visual-toc-and-code).

## Context
`projection.ts` segments the source and projects modelled constructs; anything else stays a raw
box. Tables were modelled in [visual-view-links-images-tables](visual-view-links-images-tables.md)
(`table.header` stayed raw). Typst has no checkboxes: the Universe package cheq renders
`- [ ] todo` / `- [x] done` as checkboxes under `#show: checklist`.

## Acceptance
vitest for every projection round-trip (byte for byte + exhaustive position map), input rule,
command and the numbering computation; an engine fixture for cheq compiled in a vitest;
Playwright spec (written, not run in the sandbox).

## Out of scope
Code blocks, `#outline`, figures. Nested task items, header columns, `table.cell`.

## Outcome
- **Blockquote** ↔ standalone `#quote(block: true, ..named)[content]` (named arguments only,
  `block: true` among them). Tiptap's blockquote holds blocks segmented like the document; the
  source around the content (`#quote(..)[`, `]`, whitespace inside) is its `layout`, so other
  arguments such as `attribution` stay untouched and an edit changes only the quoted text. New
  quotes print `#quote(block: true)[..]`. Toolbar "Quote" (Mod+Shift+B), input rule `> `.
  Inline quotes and `block: false` stay as they were.
- **Page break** ↔ standalone `#pagebreak(..)` with any arguments, kept verbatim: an atom shown as
  a labelled dashed divider ("Page break", "(weak)" with `weak: true`). Toolbar
  "Insert page break" (Mod+Enter).
- **Horizontal rule** ↔ standalone `#line(..)` with only named arguments, `length: 100%`, and none of
  `start` / `end` / `angle` (`stroke` etc. kept verbatim). Every other `line` stays raw. Toolbar
  "Horizontal rule". Input rule `---` (also `—-`, `___ `, `*** `) **only when the typed characters
  are the whole paragraph**: in Typst markup `---` is an em dash, so typed inside text it stays
  text (printed escaped, `\-\--`).
- Page break and rule are recognised in `call-atoms.ts` (`callAtomType`); every block atom with a
  `src` prints it verbatim (`isSourceAtom`), so further call atoms need no printer change.
- **Table header** ↔ a table whose first positional argument is a one-row
  `table.header([..], ..)` / `table.header[..][..]` (closed content blocks only, exactly `columns`
  cells): those cells are Tiptap `tableHeader` cells. While the header state matches the source,
  cells print in place; toggling it re-prints the table canonically with or without
  `table.header(..)` around the first row (toggling back restores the original source). Toolbar
  "Header row" (Tiptap's toggleHeaderRow). Headers with arguments (`repeat:`), partial rows, a
  header after cells or a second header stay raw.
- **Task list** ↔ `- [ ] text` / `- [x] text` bullet items (one paragraph; a space or the end after
  the box). cheq 0.4.0 (latest, compiler 0.15.0, MIT) is suitable: Tiptap's TaskList/TaskItem
  (not nested) with list anchors; the box is hidden syntax, so clicking a checkbox flips only the
  `[ ]`/`[x]`. Mixed lists split into task and bullet lists; other cheq boxes (`[/]`, `[-]`,
  `[X]`) and enum items stay plain text. `ensureChecklistPreamble` (`checklist-preamble.ts`) adds
  what is missing of `#import "@preview/cheq:0.4.0": checklist` and `#show: checklist` to the
  top-level raw blocks, exactly once (any cheq version or `*` import and `checklist.with(..)`
  count); a plugin runs it whenever a Visual edit adds a task item, in the same undo step. Source
  edits are left alone. Toolbar "Task list" (Mod+Shift+9), input rule `[ ] ` / `[x] `. Fixture
  `src/engine/fixtures/cheq-0.4.0` + `cheq.test.ts` (compiles; the boxes are not drawn as text).
- **Heading numbers**: `numbering.ts` applies Typst numbering patterns like typst-library
  (`1`, `a`, `A`, `i`, `I`, `*`, `①`; prefix/suffix and the repeat-last-symbol rule; Arabic
  fallback where a system cannot represent a number; other numeral systems → no numbers).
  `heading-numbering.ts` follows top-level `#set heading(numbering: ..)` rules in document order
  and Typst's heading counter (only numbered headings step it; skipped levels count from 0). A
  node decoration (`data-heading-number`, drawn by CSS `::after`) puts the number in a gutter right
  of the text; not editable, not in the source. Toolbar toggle "Numbered headings" adds
  `#set heading(numbering: "1.")` after the leading raw blocks or removes the numbering argument
  from every top-level rule (blocks left empty are deleted).
  Limitations: rules in content blocks, show rules, `#heading(numbering: ..)` calls, headings inside
  raw boxes, numbering functions and non-Latin numeral systems are not reflected (the preview is
  exact).
- Tests: `call-atoms.test.ts`, `quote.test.ts`, `table-header.test.ts`, `task-list.test.ts`,
  `numbering.test.ts`, `heading-numbering.test.ts` (round trips, position maps, edits),
  `block-nodes.dom.test.ts` (toolbar, input rules, checkboxes, undo, decorations in jsdom),
  `src/engine/cheq.test.ts`; Playwright `tests/e2e/visual-block-nodes.spec.ts` (needs
  `mise run test:e2e`).
