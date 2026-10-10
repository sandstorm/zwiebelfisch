# "Changes since …" per file
Status: done (branch task/changes-per-file)
Depends on: nothing
Touches: src/features/changes, src/features/preview/preview.ts, src/features/versions, src/typst-editor.ts,
src/typst-editor/editing-views.ts, tests/e2e/changes.spec.ts, docs

## Goal
User report: "Changes does not seem to work at all (no display or anything)". First prove whether
markers appear at all through the real widget; then make "Changes since …" cover every `.typ` file,
not only the main file (in the demo's advanced example almost all text is in `chapters/*.typ`).

## Context
- `ChangeTracking` (features/changes) owned one document (the main file), its two views and one
  preview path. `EditingViews` creates views lazily; `Preview.showChanges` drew one path only.
- GitLab rooms: `RoomVersions.base(path)`; `VersionControls` passed only the main file's base.

## Acceptance
- jsdom test through `createTypstEditor` (preview stubbed): edit the main file, click the toggle →
  `.typst-diff-insert` in the Visual view, `.cm-changedLine` in the Source view, ranges to the preview.
- Every Typst file has its own base: as opened; created since → all new; room sync → reset for all;
  GitLab: `base(path)`, null → all new. One toggle, one label. Host `setBase(text, label?, path?)`.
- Views get their document's base when created; preview bars for all paths; diffs only while shown.
- Accepting a chunk in the Source view moves that file's base only.
- e2e spec: a chapter edit in the advanced example shows changes; toggle label.

## Out of scope
Diffs of images/assets; per-file labels; caching the base's syntax tree (followups).

## Outcome
- **Was there a wiring bug?** Not for the main file: the new widget test
  (`src/typst-editor.test.ts`) shows markers in both views and ranges sent to the preview after
  editing the main file and clicking the toggle. The report is explained by the known limitation:
  only the main file was tracked, and in the advanced example the text lives in the chapters, so
  editing there (or opening a chapter) showed nothing at all. The toggle is also off by default
  ("Changes since opened"), so nothing shows before it is clicked.
- `ChangeTracking` now takes the `Project`: bases per `TypstDocument` (renames keep them), a
  lazy per-path fallback (`''` for "opened", `versions.base(path) ?? ''` in GitLab rooms),
  `attach(document, views)` (from `EditingViews.onCreate`), `setBase(base, path = main)`,
  `setBases(label, fn)`, `accept(document, base)`, `resetOpened()`, `refresh()`.
  Diffs only while shown, per edited file; bars of deleted/renamed paths are cleared.
- `Preview.showChanges(path, ranges)` keeps ranges per path and draws all of them (one boxes
  request per path, merged; one draw per microtask).
- `VersionControls` hands over a per-path base function; host `setBase(text, label?, path?)`.
- Tests: changes.test.ts (per file, new file, rename, sync, setBase(path), setBases, accept),
  editing-views.test.ts (onCreate), versions.test.ts, typst-editor.test.ts (widget level,
  incl. accept in the Source view). e2e `changes.spec.ts` extended (not run in the sandbox).
- Needs a browser run: `mise run test:e2e` (changes.spec, gitlab.spec), and the checklist rows
  "Changes since …" in docs/demo-playground.md.
