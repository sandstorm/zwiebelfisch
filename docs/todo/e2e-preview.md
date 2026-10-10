# E2E: preview, preview UX, multi-file UI and web-component specs

Status: done (branch task/e2e-preview)
Depends on: nothing
Touches: tests/e2e/{fixtures,preview,preview-ux,multi-file-ui,web-component}.spec.ts, src/editor/editing-views.ts

## Goal
`mise run test:e2e` on main failed 16 tests (test × browser) in these four specs. Find
the root cause of each and fix the app where the test describes intended behaviour.

## Context
Results of the user's run: error-context.md + trace.zip per failing test. Every failure was a
60 s timeout of an action waiting on its actionability checks.

## Acceptance
- Each failure explained; app bugs fixed with a vitest regression test.
- `mise run quality`, `typecheck` and `test:unit` pass; the specs need a browser run by the user.

## Out of scope
src/comments and the comment specs (task/comments-drafting).

## Outcome
- **App bug: the error count did nothing visible from the Visual view.** `EditingViews.reveal(…,
  inSource)` revealed the error in the source view while it was hidden. It now switches to the
  Source tab first (vitest: `editing-views.test.ts`). The e2e test now starts from the Visual
  view and checks the switch. (preview.spec › clicking the error count…, all browsers)
- **Stale tests: the Visual tab is shown first.** Typing into the hidden source editor timed out
  in "shows compiler errors…" (preview.spec) and "dispatches change…" (web-component.spec), all
  browsers. They now open the Source tab first.
- **Glyph clicks.** Playwright's `click()` hits the middle of a glyph's box and requires the
  element there to be the glyph. Typst glyphs are `<use>` elements with a white page-background
  `<path>` beneath; where the middle is blank, the background "intercepts pointer events":
  - multi-file-ui › clicking text of another file… (all browsers): the first glyph of page 2 is
    the "C" of "Chapter", whose middle is empty.
  - Firefox only (preview.spec › clicking text… selects its source / …in the visual view,
    preview-ux › clicking keeps working when zoomed in / highlights the clicked text): the
    middle of the demo heading's "H" lies 0.06 pt (about 0.08 px) above the bottom edge of the
    crossbar (box y −0.034…10.870, middle 5.418, crossbar 5.359…6.166). Chromium and WebKit
    still hit the crossbar; Firefox, with its own box and hit-test rounding, does not.
  The preview maps the click position to the source, not the ink, so this was no app bug.
  `clickGlyph()` in `tests/e2e/fixtures.ts` waits for the glyph to be visible and clicks the
  middle of its box with `force` (skipping only the hit-target check). The assertions are
  unchanged. visual.spec.ts:57 clicks a glyph the same way and could use it too (not owned here).
