# Diff rendering (compare with a previous version / track-changes view)

Status: open
Depends on: projection-position-map (for the Visual view part)
Touches: src/diff/** (new), src/source-view/**, src/visual-view/**, src/preview/**, src/editor/**

## Goal
Show what changed against a base version (last saved / last git commit / any version):
- **Source view:** inline unified diff (`@codemirror/merge` `unifiedMergeView`) with per-chunk
  accept/reject.
- **Visual view:** insertions highlighted, deletions shown as struck-through widgets, i.e. the
  "track changes" look non-technical users know from Word — computed from the text diff, mapped
  through `sourceToPos`.
- **Preview:** changed regions marked with change bars in the margin (like LaTeX `changebar`):
  map each changed source range with `jumpFromCursor` (or compile the base too and compare page
  hashes for "pages changed" as a first step).
- Toggle "Show changes" in the widget; base supplied via the widget API (`setBase(text)`), later
  by the server (GitLab `baseSha`, version history).

## Design notes
- One text diff (e.g. `diff-match-patch` or CodeMirror merge's `diff`, word-level cleanup) is the
  single source; all three renderings derive from it. Keep it in one `Diff` module.
- Typst-aware cleanup: snap diff boundaries to syntax leaves (Lezer tree) so `*bold*` → `_bold_`
  shows as a formatting change, not character noise.
- "Suggesting mode" (edits recorded as proposals instead of applied) is a separate, later task;
  with text as the source of truth it maps naturally to a branch/merge-request workflow.

## Acceptance
- vitest: diff → decoration sets for both views from fixtures (insert, delete, formatting change,
  change inside raw block).
- Playwright: `setBase()` + edit → highlighted insertion in Visual view, change bar on the preview page.
