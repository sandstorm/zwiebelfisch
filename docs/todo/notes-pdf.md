# Margin notes in the PDF: a nicer default look; PDF download with or without comments

Status: open — start after restructure-src is merged
Depends on: comments-drafting, comment-replies (the thread format), restructure-src
Touches: crates/typst-engine (PDF export), the engine wrapper and worker protocol, add-margin-note
(preamble), the widget's preview toolbar, docs/embedding.md

## 1. A better default look of drafting notes (user, 2026-10-10)
drafting's default (a plain bordered box and a thin line) looks rough. When the editor adds the drafting import, it
also adds **one** defaults call, idempotently (like the import), e.g.:
```typst
#import "@preview/drafting:0.2.2": margin-note, set-margin-note-defaults
#set-margin-note-defaults(
  stroke: rgb("#e0a800") + 0.6pt,
  rect: (..args) => rect(fill: rgb("#fff8e0"), radius: 2pt, inset: 4pt, ..args),
)
```
- Pick the style with the typst CLI (`mise exec -- typst compile`): render samples of point notes,
  range notes and threads with replies, at the demo's page setup and at A4, and choose a calm,
  readable look: small text (~8pt), the highlight colour matching the Visual view's note colour,
  a subtle connector. Put before/after PNGs in the task Outcome.
- Check which keys drafting 0.2.2 accepts (`margin-note-defaults`: stroke, rect, side, hidden,
  margin-*, page-offset-x, fill?). Unknown keys panic.
- Never overwrite an existing `set-margin-note-defaults` call. Documents that already style their
  notes stay as they are.
- Range-note highlight: drafting's inline highlight look also gets a matching default if it is configurable.

## 2. PDF download: with comments / without comments (user, 2026-10-10)
- Engine: add PDF export to the wasm (`typst-pdf` crate, same version as typst). New API
  `exportPdf(main, options) → Uint8Array`, run in the worker like compile. Report the wasm size
  increase (raw/gzip) in the Outcome.
- **Without comments:** compile a generated wrapper entry instead of `main`, which hides every note without
  touching the document:
  ```typst
  #import "@preview/drafting:0.2.2": set-margin-note-defaults
  #set-margin-note-defaults(hidden: true)
  #include "/main.typ"
  ```
  (only when the project uses drafting). Verify that a later `set-margin-note-defaults(..)` in the
  document doesn't turn them on again. If it does, use `sys.inputs` or a show rule instead and explain.
  Range notes keep their text without the highlight. Check that `hidden` does that.
- Widget UI: a "Download PDF" button in the preview toolbar with a small menu "With comments" /
  "Without comments" (the plain button = without comments, the usual "final" version; decide and
  document). File name from the main file (`main.pdf`, `main-with-comments.pdf`).
- Host API: `editor.exportPdf({ comments: boolean }) → Promise<Blob>` (and on `<typst-editor>`), so
  hosts can save it themselves. Also a widget option to hide the button.
- Errors: if the document has compile errors, tell the user (status) and don't download a stale PDF.

## Acceptance
- vitest: engine exports a non-empty PDF (starts with `%PDF-`); the wrapper hides notes (compile
  both variants: glyph count in the margin differs, or check via a text extraction of the PDF
  if simple); the defaults call is added once and never duplicated; existing defaults untouched.
- Playwright (user-run): click Download PDF → a download event with a `.pdf` file, for both variants.
