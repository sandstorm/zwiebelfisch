# File tree on the left, and file links in Typst code

Status: done (branch task/files-tree) — Playwright specs written, need a browser run
Depends on: multi-file-ui, restructure-src
Touches: src/features/files/** (FilePanel, tree/), src/typst-editor/layout.ts (new), src/typst-editor.ts,
src/core/project/path-references.ts (new), src/features/source-view/file-links.ts (new),
src/features/visual-view/nodes/{raw-box,box-links}.ts, images/image-tools.ts (path label), typst-editor.css
(grid columns, file link styles), tests/e2e/*

## Goal (user, 2026-10-10)
1. "`#import "template.typ": template` => needs a way to jump to the file." File paths in Typst code
   (`#import`, `#include`, `image`, `read`, `bibliography`, `json/csv/yaml/…`) open their file:
   Mod+click, a hover underline + tooltip, a keyboard command in the Source view; "Open <file>"
   on Visual raw boxes, a clickable image path; a missing `.typ` file can be created.
2. "File browser should be a tree on the left (expandable)." The horizontal file bar becomes a
   left side panel with the project as a tree: expandable folders (remembered per session), main
   file marked, active file highlighted, icons by kind, collaborators' presence dots, all actions
   (new file / folder, upload, rename, delete, drag & drop), keyboard navigation, resizable and
   collapsible; collapsed by default for single-file projects; an overlay when narrow.

## Context
- The dockview spike (docs/2026_10_10_dockview-spike.md) planned a hand-built `Layout` module with
  panel ids; the file panel is its first panel, so the Notes | Inspector panel can follow.
- `core/project/paths.ts` already resolves Typst paths (`resolvePath`).

## Acceptance
- [x] One deep module for path references (`findPathReferences`, `pathReferenceAt`, Lezer-based),
  plus `FileLinks` / `describeLink`; tested (path-references.test.ts).
- [x] Source view: marked paths, Mod+click, Alt+Enter, tooltip with Open / Create; tested
  (file-links.test.ts), also through the widget (typst-editor.test.ts).
- [x] Visual view: "Open …" row on raw blocks naming files, clickable image path; tested (box-links.test.ts).
- [x] Tree model (build, sort folders first, expand/collapse, keyboard moves, relocate) tested
  (tree-model.test.ts); panel actions, keyboard, drag & drop tested (files.test.ts); Layout
  (default/choice, resize, narrow overlay, memory) tested (layout.test.ts).
- [x] `fileList` keeps its meaning (`auto` opens the panel with more than one file).
- [x] Playwright (not run here): tests/e2e/files-tree.spec.ts; existing specs updated.
- [x] ARCHITECTURE.md ("Layout", "File panel", "File links"), docs/embedding.md, docs/demo-playground.md.

## Out of scope
- Real (persisted) empty folders: the project has none; a folder exists while a file is in it.
- Undoable / atomic folder operations (they are one change per file).
- Links for paths computed at run time; jumping to a symbol inside the imported file.

## Outcome
- **Path references** (`core/project/path-references.ts`): `findPathReferences(text, {tree?, from?,
  to?})`, `pathReferenceAt`, `describeLink`; one definition for both views.
- **Keyboard command: Alt+Enter** (F12 is taken by browsers' developer tools; Mod+Enter is
  CodeMirror's "insert blank line").
- **Layout** (`typst-editor/layout.ts`): rail with a button per panel + one open side panel,
  resizable (160–480px), open state and width per browser session (`sessionStorage`, keyed by
  the main path); below 720px the panel overlays the editor and closes after choosing a file.
- **FilePanel / FileTree** (`features/files/`, `tree/`): the tree with roving focus; Rename /
  Delete act on the focused row (folders with their files); New folder makes a panel-only empty
  folder; drag & drop moves rows and uploads OS files into folders. `toPath` allows nested folders.
- Decision: `auto` follows the file count until someone toggles the panel, so uploading a first
  image opens the panel (image-upload.spec's layout check now allows the editing column to get
  narrower from the left).
- Needs a browser run: `mise run test:e2e` (files-tree, multi-file-ui, demo-examples, image-upload),
  `mise run test:e2e-gitlab` (gitlab.spec); look at the tree's styling and the narrow overlay by hand.
