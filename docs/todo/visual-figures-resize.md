# Visual view: image figures and resizing

Status: done (branch task/visual-figures-resize)
Depends on: visual-view-links-images-tables, visual-view-compiled-boxes
Touches: src/visual-view/{projection,extensions,raw-box,rendered-box}.ts, new image-call.ts,
image-edits.ts, image-tools.ts; src/editor/styles.css; tests/e2e/visual-figures.spec.ts

## Goal
- `#figure(image("x.png", width: 50%), caption: [Some *caption*]) <fig:x>` shows as the image
  with its caption editable as rich text below it. Other arguments and the label round-trip
  exactly. A bare `#image(..)` stays an image block.
- Images can become figures ("Add caption") and back ("Remove caption").
- A selected image shows drag handles; dragging resizes it live and writes `width: NN%`.
- Every edit is minimal: only the changed argument's text is replaced.

## Context
Images were `image` atoms edited like raw boxes and shown as their file (compiled boxes).
Figures were raw blocks. Other branches touching nearby code: comments-drafting
(projection.ts), visual-toc-and-code (toolbar insert group), fix-image-upload-ui (insert flow).

## Acceptance
- vitest: figure round-trips (caption markup, label, extra args, captionless, empty caption,
  figure in a table cell, unmodelled figures stay raw), caption/image edits change only that
  part, add/remove caption, width edit as a minimal change, the position map stays precise.
- jsdom: click selects, double-click shows code, toolbar buttons, drag writes the width.
- Playwright (needs a browser run): `tests/e2e/visual-figures.spec.ts`.

## Out of scope
Figures whose body is not an `image(..)` call (tables, content), multi-paragraph captions,
height/crop handles, image alignment.

## Outcome
- **Projection:** `#figure(image("literal path", ..), ..named) <label>?` with an optional
  one-paragraph `caption: [..]` becomes `figure` > `image` (the call without `#`) +
  optional `figureCaption` (a textblock). The figure's `layout` keeps the source around the
  two (`open`, caption `before`/`open`/`close`, `rest` with the other arguments and the
  label), so a caption edit re-prints only the caption, a width edit only the call. An added
  caption is printed as `, caption: [..]` right after the image call; a removed one takes its
  argument and the comma before it along. Enter in a caption leaves the figure.
- **Edits** (`image-edits.ts`, one transaction each = one undo step): add caption (image →
  `#figure(image(..), caption: [])`, cursor in the caption), remove caption (a figure with
  nothing else → `#image(..)` again; with a label or other arguments it stays a figure and only
  the caption argument goes, so references keep working), width, alt text.
  `image-call.ts` edits arguments in place (replace the value / append after the last
  argument / remove with the preceding comma).
- **Resize decision:** dragging always writes **percent of the text width**, whole numbers,
  1–100 %, replacing whatever unit was written (`8cm` → `42%`). The Visual view only knows
  widths relative to its own column, and percent stays right when the page size changes.
  Widths in `%`, `pt`, `mm`, `cm`, `in`, `em` are shown as written; others show the natural size.
  Images in figures are centered, so their handles change the width twice as fast.
- **UI:** a click on an image's picture selects it (double-click, Enter or "Edit code" open
  the code). While selected: six handles (corners, sides), a live size badge while dragging,
  and an "Image" toolbar: Add/Remove caption, Width 25/50/75/100 % (keyboard alternative to
  dragging), Alt text (popover), Edit code.
- **Insert image decision:** the toolbar still inserts a bare `#image(..)`; "Add caption" is
  one click on it. A new figure with an empty caption would already print "Figure 1" in the
  document, and the insert flow is being reworked on task/fix-image-upload-ui.
- Tests: `image-call.test.ts`, `image-edits.test.ts`, `image-tools.test.ts` (jsdom), figure
  cases in `projection.test.ts`; Playwright `tests/e2e/visual-figures.spec.ts` and the
  updated image-click test in `visual-compiled-boxes.spec.ts` need `mise run test:e2e`.
