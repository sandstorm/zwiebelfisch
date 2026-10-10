# Visual view v1: source-anchored ProseMirror projection

Status: in-progress (main agent, 2026-10-10)
Depends on: nothing
Touches: src/visual-view/**, src/editor/** (view switch)

## Goal
A Word-like editing view (ProseMirror) over the Typst text, where the text stays the source of
truth: unmodelled constructs are raw atoms, edits produce minimal text changes.

## Acceptance
- `print(project(src)) === src` for a fixture corpus (vitest).
- Editing one paragraph changes only that paragraph's source range.
- Supported: paragraph, heading, strong, emph, bullet/numbered lists (flat), soft/hard breaks;
  everything else raw_block/raw_inline.
- Toggle Visual/Source in the widget; e2e spec for typing in the visual view.
