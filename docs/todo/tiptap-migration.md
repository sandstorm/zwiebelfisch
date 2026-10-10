# Visual view on Tiptap + recursive sync

Status: done (4170f5b) — firefox/webkit e2e specs need a user run
Depends on: nothing
Touches: src/visual-view/**, package.json

## Goal
Move the Visual view to Tiptap (ProseMirror underneath) for Word-like behaviour (input rules,
list keymaps, menus) while keeping the projection. Make `syncBlocks` recursive: replace only the
changed inline range inside a changed block (cursor stays put for remote/source edits), then
refresh the block's `src`/`sep` and pristine state. Fix Cmd/Ctrl+B/I falling through to the
browser in Safari/Firefox; add webkit + firefox Playwright projects.
