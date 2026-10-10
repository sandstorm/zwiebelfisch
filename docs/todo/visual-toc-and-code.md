# Visual view: table of contents and code elements

Status: done (branch task/visual-toc-and-code) — Playwright spec written, needs a browser run
Depends on: visual-view-links-images-tables, visual-view-compiled-boxes
Touches: src/visual-view/projection.ts, src/visual-view/raw-code.ts (new),
src/visual-view/code-block-view.ts (new), src/visual-view/extensions.ts, src/visual-view/toolbar.ts,
src/visual-view/raw-box.ts, src/editor/styles.css

## Goal
- **Table of contents:** `#outline(..)` (any arguments) is a recognisable block in the Visual view,
  showing the compiled outline where compiled boxes are available; the toolbar inserts
  `#outline()` as its own block at the cursor.
- **Code:** Typst raw blocks (```` ```lang … ``` ````) and inline raw (`` `code` ``) become real
  nodes: a code block with an editable language and plain, monospace text edited in place, and an
  inline code mark. The source round-trips exactly (fence length, language tag, backtick counts).
  Toolbar: "Code" (inline) and "Code block".

## Context
Before, a run that was only a raw block became a `rawBlock` (Typst code in CodeMirror) and inline
raw became a `rawInline` box. `#outline()` was a `rawBlock` (already rendered as a snippet).

## Acceptance
vitest: projection round-trips, edits, fence and language handling, exhaustive position map
(fixtures `code`, `outline`), toolbar commands (jsdom). Playwright spec for the toolbar actions
and editing (not run in the sandbox).

## Out of scope
Syntax highlighting inside code blocks; dedenting indented raw blocks in the view; `#raw(..)` calls
(they stay raw boxes).

## Outcome
- `raw-code.ts` reads a lezer `Raw` node (fence, language tag, text range without the whitespace
  Typst trims) and writes delimiters for edited code: single backticks where possible, else a
  fence longer than any backtick run in the text (a space before the closing fence after a
  trailing backtick); code blocks keep their fence unless the text needs a longer one.
  `codeLanguage` cuts a language to what Typst reads as a tag (`c++` → `c`).
- `codeBlock` (Tiptap's, plus the anchor `fence`): a run that is exactly one block raw (3+ backticks
  around a line break). Its text is the source between the delimiters, so the position map is
  per character; an empty code block maps to between its fences.
- `code` mark (Tiptap's, extended: combines with bold/italic/link; `fence`, `lang` attrs): inline
  raw on one line. Printing keeps code innermost (`*`x`*`, closed and reopened around other
  formatting changes) and never escapes its text. Empty or multi-line inline raw stays `rawInline`.
- `outline` block: a standalone `#outline(..)` call, kept and edited like an image box, headed
  "Table of contents", compiled through the box renderer while not focused.
- Code blocks render through `code-block-view.ts`: a header with a "Language" field (sets
  `language` as one types; Enter/Escape/ArrowDown go to the code) over `<pre><code>`.
- Toolbar: "Code" (Mod+E) next to bold/italic, "Code block" next to the lists, "Table of contents"
  in the insert group. Typing `` `x` `` or ```` ``` ```` also converts (Tiptap input rules).
- Tests: `projection.test.ts` (code blocks, inline code, table of contents, fixtures), `toolbar.test.ts`;
  Playwright `tests/e2e/visual-toc-and-code.spec.ts` (needs `mise run test:e2e`).
- Follow-ups: change decorations outline only `raw*` atoms, not `image` / `outline` boxes; code
  blocks are not syntax highlighted.
