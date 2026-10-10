# Margin notes: page-margin fix and a comment gutter in the Visual view
Status: done (branch task/comments-gutter)
Depends on: comments-drafting (done)
Touches: src/editor/add-margin-note.ts, src/editor/page-margin.ts (new), src/visual-view/margin-notes.ts,
src/visual-view/notes-gutter.ts, note-list.ts, card-layout.ts (new), src/visual-view/visual-view.ts,
src/editor/styles.css, src/engine/packages.test.ts, tests/e2e/margin-notes.spec.ts, ARCHITECTURE.md, docs/embedding.md

## Goal
1. **Bug (user report):** adding a note to the demo fails with
   `@preview/drafting:0.2.2/drafting.typ: type relative length has no method 'keys'`.
2. **Feature (user):** "Notes should be editable in a gutter, similar to how it works in the
   Tiptap Pro comments extension." Each note gets a card in a column right of the Visual view's
   text, beside the text it belongs to. Cards can be edited in place and resolved.

## Context
- The bug is in drafting 0.2.2, not here:
  [drafting.typ line 640](https://github.com/typst/packages/blob/main/packages/preview/drafting/0.2.2/drafting.typ#L640)
  does `page.margin != auto and "inside" in page.margin.keys()`, which crashes when the page
  margin is one length. Typst turns uniform dictionaries (`(rest: a)`, `(x: a, y: a)`) back into a
  length, so only `auto` and margins that differ by side work (checked with typst 0.15.1). The
  demo says `#set page(width: 16cm, height: auto, margin: 1.5cm)`.
- Before this task, notes showed as inline bubbles that opened a one-line text field
  (`margin-notes.ts`).

## Acceptance
- vitest: margin rewrite cases (`add-margin-note.test.ts`); engine compiles notes with the demo's
  page setup after the rewrite and shows the upstream error without it (`packages.test.ts`).
- vitest: card layout (pure), note list (follow across edits, edit, delete, find), gutter in jsdom
  (cards, editing → source, Escape, multi-line, escaping, undo, resolve for both kinds, open card
  vs. remote changes, focus/hover sync, placement in an animation frame, `editNote`).
- Playwright spec for add → aligned card, edit → source + preview, resolve → source cleaned,
  no overlap, highlight ↔ card, narrow popover.

## Out of scope
Threads/replies, authors, formatted (non-markup) note editing, a Source-view gutter, moving files
(src/ is restructured on another branch).

## Outcome
- **Page margins** (`src/editor/page-margin.ts`, called by `addMarginNote`, same change and undo step):
  every top-level `#set page(.., margin: m)` whose `m` is a literal Typst reads as one length (a
  length, a sum like `1cm + 5%`, or a side dictionary with one value for all four sides) becomes
  `margin: (right: R, rest: m)`. **Decision:** R = 4cm (room for drafting's notes); when `m` is
  an absolute length of 4cm or more, R = the next whole cm + 1 (equal sides would be uniform and
  crash again). `auto`, absent and non-uniform margins, variables and spreads are not touched.
  The rewrite happens with every added note, so a file whose import already exists is fixed too.
- **Demo:** no demo example contains notes, so none was changed; `hello` (`margin: 1.5cm`, the
  e2e default) gets `(right: 4cm, rest: 1.5cm)` with its first note. The e2e margin check now
  measures the last 4cm of the page.
- **Gutter** (`notes-gutter.ts`; ARCHITECTURE.md › Comments = margin notes has the contract):
  - Cards: highlighted text (range notes), the note's markup in a multi-line text area
    (Mod+Enter or blur saves, Escape cancels), "Resolve note" (point: the call goes; range: only
    the call goes, the text stays). Each change is one transaction, so one undo step.
  - In the text, a point note is a marker and a range note a highlight; the bubbles are gone.
    Clicking a marker focuses its card; the cursor in highlighted text makes its card active
    (aligned exactly, highlighted); hovering either side highlights both.
  - The cards' state is a ProseMirror plugin (note list with keys followed through mappings,
    anchor decorations with `data-note-key`). Cards are DOM outside ProseMirror, so an open card
    survives every re-render and remote change and saves into its own note.
  - Layout: `layoutCards` (pure) on measurements taken in one `requestAnimationFrame` after doc,
    active-note, card-text or size changes (`ResizeObserver` on body and text, captured image
    `load`s). Below 640px body width only the active card shows, as a popover under its anchor.
  - The column only shows while the document has notes.
- **Tests:** vitest as listed under Acceptance (all green, `mise run quality` green).
  Playwright: `tests/e2e/margin-notes.spec.ts` rewritten for the gutter and
  `collab.spec.ts` › margin note adapted, **not run** (sandbox: no browser). Run `mise run test:e2e`.
- **Not done / follow-ups:** the first layout animates cards from the top (CSS `top` transition);
  the gutter is in the Visual view only (Source view unchanged, as asked); notes in the preview
  are still drafted by drafting itself.

### Upstream bug report (drafting 0.2.2), ready to file
> **`margin-note` fails when the page margin is a single length**
>
> With typst 0.15.1 and drafting 0.2.2:
> ```typst
> #import "@preview/drafting:0.2.2": margin-note
> #set page(width: 16cm, height: auto, margin: 1.5cm)
> Text#margin-note[note]
> ```
> fails with `error: type relative length has no method 'keys'` at drafting.typ:640:43.
> Line 640 checks `page.margin != auto and "inside" in page.margin.keys()`, but `page.margin` is
> a `relative` length here (Typst also normalises uniform dictionaries such as `(rest: 1.5cm)` or
> `(x: 2cm, y: 2cm)` to a length). `_get-margins` already handles this case with
> `type(page.margin) != dictionary`. Suggested fix: guard the check the same way,
> `if type(page.margin) == dictionary and "inside" in page.margin.keys() { … }`.
> Workaround: a margin that differs by side, e.g. `margin: (right: 4cm, rest: 1.5cm)`.
