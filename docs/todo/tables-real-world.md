# Visual view: real-world tables
Status: done (branch task/tables-real-world)
Depends on: visual-view-links-images-tables, visual-block-nodes
Touches: src/features/visual-view/projection/ (projection.ts table and figure code, new
embedded-code.ts), nodes/nodes.ts (rawInline `code`, figure content), src/typst-editor.css,
tests/e2e/visual-tables-real-world.spec.ts

## Goal
User report: the timings table of the advanced demo (`demo/examples/advanced/chapters/results.typ`)
is only a raw box in the Visual view. "Table headers etc. not supported in the interactive
editor? But Tiptap can do this?" Real-world tables should be Visual tables:

```typst
#figure(
  table(
    columns: 4,
    align: (left, right, right, right),
    stroke: (x, y) => if y == 0 { (bottom: 0.7pt) },
    table.header([*Pages*], [*Cold*], [*Incremental*], [*Speed-up*]),
    [1], ms(18), ms(4), [4.5×],
    ...
  ),
  caption: [Median compile times (illustrative numbers).],
) <tab:timings>
```

## Context
Headers (`table.header`) and function-valued named arguments were already modelled. What kept
this table raw: cells written as expressions (`ms(18)`) instead of content blocks, and the
figure around it (figures modelled only image bodies).

## Acceptance
- Expression cells (`ms(18)`, `str(x)`, `$x^2$`, `"s"`, `1pt`, `x.y`) are cells holding a code box
  (rendered when a renderer is set), printed back bare. Typing next to the box makes the cell
  content `[#ms(18) more]`; code that is no longer one expression too; clearing it gives `[]`.
- `table.header(..)` with content and/or expression cells.
- Named arguments (closures, arrays, multi-line) stay verbatim.
- Unchanged cells keep their source; a cell edit changes only that cell; adding/removing rows
  or columns and toggling the header keep the table's style.
- `#figure(table(..), caption: [..]) <label>` is a figure with a table and an editable caption.
- vitest: round-trips (byte-exact, precise position map), the edits above, the real demo file.
  Playwright spec written.

## Outcome
- **Modelled.** A positional table argument is a cell if it is a closed content block or an
  expression that reads the same after `#` in markup (`isEmbeddable` in `embedded-code.ts`). Such
  a cell holds one paragraph with one `rawInline` (`code: true`, `src` = the expression without
  `#`), so the box shows the compiled snippet (the source range it maps to is exactly its `src`)
  and edits as code. Printing (`printCell`): bare while the cell is just that box and its code
  is one expression, else `[` + content + `]` with the box as `#code` (`markupSource`; math stays
  `$..$`), cleared `[]`. Header cells may be expressions too.
- **Style on re-print.** `TableLayout.style` (`TableStyle`) records the source before the first
  row (with the `columns` count cut out), named arguments between rows, the cell and row
  separators of the last rows, the header call's syntax and the source after the last row. A
  table whose shape changed re-prints with these instead of the canonical form: a 4-space
  indented table gets a 4-space indented new row, a one-line table stays on one line, the
  trailing comma and closing `)` stay as written. Only the padding inside a content cell's
  brackets (`[ a ]`) is lost on a re-print. Editor-made tables print as before.
- **Figures.** `figure` content is `(image | table) figureCaption?`; `#figure(table(..), ..)` is
  projected like `#table(..)` inside, the caption rich text. A table figure is centred
  (`.typst-visual__figure .typst-visual__table`). The image tools only act on image bodies.
- **Still raw (follow-ups).** `table.cell(..)` (with or without `colspan`/`rowspan`: Tiptap has
  the attributes, but placing spanned cells in the grid, printing them back and a merge/split UI
  are a task of their own), `table.hline`/`table.vline` (would fit in the gaps, but a re-print
  must keep them), `table.footer`, `columns: (1fr, 1fr)` and other non-integer column specs,
  expressions that need parentheses after `#` (`-1`, `a + b`), spreads, comments between
  cells, and `columns` written after the first cell.
- Tests: `projection/table-cells.test.ts` (round-trips of eight variants, expression cell edits,
  typing next to a box, clearing, outside changes via `syncDoc`, add/delete row and column,
  header toggles incl. the bracket form, figures, the real `results.typ`),
  `block-nodes.dom.test.ts` (toolbar Add row / Header row on a figure table in a VisualView);
  existing expectations changed where a header toggle now keeps the one-line style.
  `tests/e2e/visual-tables-real-world.spec.ts` is written but not run (sandbox: no browser):
  compiled box in a cell, editing its code, the advanced example's figure table, typing in a cell
  and Add row.
