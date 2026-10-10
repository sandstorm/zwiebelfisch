# Diagnostics UI

Status: open
Depends on: nothing
Touches: src/source-view/**, src/editor/**, src/preview/preview.ts (only if needed), tests/e2e/**

## Goal
Typst errors and warnings are visible: underlined in the Source view (CodeMirror lint with
message + hints on hover), and a compact status indicator in the widget ("✓ compiled" /
"2 errors") that jumps to the first error on click. While there are errors the preview keeps the
last good pages (already the case) but should look visibly stale (e.g. dimmed).

## Context
- `Preview` already reports `onDiagnostics(diagnostics)` with UTF-16 `from/to` and `path`.
- `@codemirror/lint` is installed; `codemirror-lang-typst/lezer` also has a syntax linter — avoid
  double reporting (prefer compiler diagnostics, keep lezer lint off or merged).
- Diagnostics are for the compile of a possibly older text: map ranges through changes made
  since (CodeMirror `setDiagnostics` + mapping, or drop on edit and wait for the next compile).

## Acceptance
- Playwright: typing `#unknown` shows a lint mark and an error count; fixing it clears both.
- Diagnostics for other files (path ≠ main) are listed in the status but not marked in the editor.
- `mise run quality` green.

## Out of scope
Visual-view error display (raw atoms could show errors later).
