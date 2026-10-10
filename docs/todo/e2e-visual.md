# E2E: failing Visual view specs (chromium, firefox, webkit)

Status: done (branch task/e2e-visual)
Depends on: nothing
Touches: tests/e2e/visual*.spec.ts, tests/e2e/visual-helpers.ts, src/visual-view/raw-box.ts, src/source-view/typst-language.ts

## Goal
`mise run test:e2e` on main failed in 21 runs of the four Visual view specs
(`visual`, `visual-toolbar`, `visual-links-tables`, `visual-compiled-boxes`). Find each root
cause, fix the app where the test describes intended behaviour, make flaky steps deterministic,
and explain browser-specific failures. Assertions stay as strict as they were.

## Context
The failure folders (error context, trace) of that run. The other failing specs (comments,
multi-file-ui, preview, preview-ux, web-component) belong to other tasks.

## Acceptance
- Two app bugs fixed with vitest regression tests (`typst-language.test.ts`, `raw-box.test.ts`).
- Specs rewritten to place the caret, select text and click the preview deterministically.
- `mise run test:unit`, `typecheck` and `quality` pass. The Playwright specs need a browser run
  by the user (`mise run test:e2e`), since the sandbox cannot start a browser.

## Out of scope
The other specs that failed in the same run. Comments (task comments-drafting).

## Outcome
App bugs:
- **Enter after `#set page(..)` indented the next line by 10 spaces** (raw blocks test, all
  browsers). codemirror-lang-typst 0.6.0 treats a delimited construct that ends exactly at the
  cursor as unfinished and aligns the new line with its first argument. `typstLanguage()` now
  wraps the package's indent service: right after a closed bracket it falls back to the syntax
  tree's indentation. This applies to the Source view too.
- **Raw boxes inside `<typst-editor>` (shadow DOM) were half-broken** (both compiled-boxes tests,
  all browsers). The nested CodeMirror is created before its node view is attached, so it took the
  document as its root. It then read focus and selection from the document: no `cm-focused`
  after clicking a rendered box, keys typed into it landed at the wrong position
  (`y + ^2$ x $`), and its theme was mounted outside the shadow root. It now gets the outer
  editor's root.

Test problems (`tests/e2e/visual-helpers.ts` holds the shared steps now):
- **`End` is not "end of paragraph"**. It goes to the end of the *visual* line. The demo's first
  paragraph wraps, and Playwright clicks its centre, which lies exactly on the line boundary
  (y = 274.14): Chromium (fractional coordinates) lands on line 2, Firefox (integer coordinates,
  y = 274) on line 1. `caretAtEnd` sets the DOM selection to the end of the block instead.
- **ProseMirror's post-focus sync**. 20 ms after the editor gains focus, ProseMirror writes its own
  selection back to the DOM unless it has seen the DOM selection by then. A key pressed within
  those 20 ms (Playwright presses `End` 2 ms after the click) is undone. That is the Firefox
  `Clic␣*new*k` failure (bold shortcut, Bold/Italic button, Undo/Redo), where Firefox delivers
  `selectionchange` later. When the click itself lands while the first compile result is being
  applied, the click is undone: the initial NodeSelection on the first `#set` box survives, Enter
  then enters that box, and "Fresh line" is typed into the code (Chromium "Heading 2", options
  disabled). `caretAtEnd` waits for the timer, then waits until ProseMirror has seen the caret.
  `beforeEach` waits for the first compiled page.
- **`Shift+Home`** (links-tables) selects nothing in Chromium and WebKit on macOS, and up to the
  document start in Firefox on macOS. That is why the heading and the first paragraph got linked
  and Remove only unlinked one part. Now `Shift+ArrowLeft` × 10 as in the toolbar spec, shared,
  followed by a check that "Fresh line" is the selected text.
- **Preview glyph clicks in Firefox**: a glyph is a `<use>` of a `<symbol>` without a size, and
  Firefox reports its box as the whole page (567 × 118 px). `use.click()` aimed at the empty page
  centre, where the page background "intercepts pointer events", and retried until the timeout.
  `clickFirstGlyph` computes the point from the glyph's origin (`getScreenCTM`). The preview and
  preview-ux specs fail in Firefox for the same reason. They are not changed here.
- Chromium "Italic button" (once): the Italic button was pressed with an empty selection (stored
  mark), so the Shift+Arrow selection never reached ProseMirror. The trace does not show why. The
  helper now asserts the selected text before the toolbar click, so a recurrence fails at the
  selection step with a clear message.
