# Restructure src/: entry points on top, internals in subfolders

Status: open — start after task/comments-drafting, task/visual-block-nodes and task/demo-playground are merged.
Depends on: those three (renames would conflict with them)
Touches: everything under src/ (crates/ stays), tsconfig/vite/eslint config, mise-tasks (engine build paths), ARCHITECTURE.md, docs/embedding.md

## Goal
Make it obvious, when you open a folder, what is API and what is internal (user decisions, 2026-10-10):
- **The most important API is on top:** `src/typst-editor.ts` (createTypstEditor).
- **Each folder has one entry file, named like the folder** (`preview/preview.ts`). Everything else
  in the folder is internal to it. Folders that grow get **subfolders named after a concept**
  (`projection/`, `toolbar/`, `worker/`), never generic ones (`parts/`, `utils/`, `internal/`).
- **Imports from outside a folder go to its entry file only.** A few documented exceptions are
  allowed (e.g. `collaboration/gitlab-protocol.ts`, which the server imports). An ESLint
  boundary rule enforces this (`no-restricted-imports` patterns or eslint-plugin-boundaries,
  exactly pinned).
- **Every file starts with a top comment:** either the context, or `See <nearest concept>` (the
  entry file, or an ARCHITECTURE.md section). `mise run quality` checks it.
- **Other languages and separate programs stay at the top level:** `crates/` (Rust engine),
  `server/` (Node collaboration server), `demo/`, `examples/`.

## Target layout
```
src/
  index.ts                     package exports
  typst-editor.ts              createTypstEditor (was editor/typst-editor.ts)
  typst-editor.css             (was editor/styles.css; feature CSS may move next to its feature)
  typst-editor-element.ts      <typst-editor> (was element/; inline-source.ts folded in or beside it)
  typst-editor/                what only typst-editor.ts uses: editing-views (Visual/Source tabs and
                               panes per document), project-renderings, collaboration-link
  core/
    typst-document/            typst-document.ts; highlight.ts, minimal-change.ts (shared types/helpers,
                               documented exceptions); yjs/ (y-delta)
    typst-engine/              typst-engine.ts (was engine/engine.ts); packages/ (packages, tar);
                               fonts/ (default-fonts, fetch-fonts + generated fonts); wasm/ (generated
                               from crates/typst-engine); fixtures/
    project/                   project.ts; paths.ts
  features/
    visual-view/               visual-view.ts
      projection/              projection, raw-code, alignment, call-atoms, image-call, numbering
      nodes/                   extensions, raw-box, rendered-box, code-block-view, page-break,
                               horizontal-rule, task-list, checklist-preamble, heading-numbers,
                               heading-numbering, text-align, margin-notes
      toolbar/                 toolbar, toolbar-action, toolbar-blocks, field-popover
      images/                  image-choices, image-edits, image-insertion, image-tools
      decorations/             highlights, change-decorations
      testing/                 jsdom-setup, test-support
    source-view/               source-view.ts; language/ (typst-language, lint)
    preview/                   preview.ts; worker/ (engine.worker, protocol, project-files, latest-only);
                               pages/ (page-list, geometry, zoom, snippet, change-bars); toolbar.ts
    diagnostics/               diagnostics.ts (was diagnostics-status); diagnostics-summary.ts
    changes/                   changes.ts (was change-tracking); diff.ts; changes.css
    comments/                  comments.ts (was comment-action); add-margin-note.ts; margin-note-syntax.ts
    files/                     files.ts (was file-switcher); asset-view.ts; upload.ts; insert-image.ts
    collaboration/             collaboration.ts; gitlab-protocol.ts (server imports it); shared-project,
                               shared-assets, remote-cursors, room-versions, in-process (tests)
    versions/                  versions.ts (was version-controls)
```
Renames of entry files to the folder name are suggestions. Keep a public class name
(`DiagnosticsStatus`) when renaming its file. Current leaks to fix while moving:
`preview/project-files`, `visual-view/field-popover`, `source-view/typst-language` are imported
from other folders.

## Acceptance
- `git mv` for all moves (history follows); no behaviour change; vitest, typecheck, quality green;
  `mise run build`, `build:lib`, `build:engine` work with the new paths; the server's import of
  gitlab-protocol works.
- The ESLint boundary rule fails on an import into another folder's subfolder (prove with a test fixture or a note).
- The top-comment check fails on a file without one; every file has one.
- ARCHITECTURE.md follows the new tree, entry points first; docs/embedding.md paths updated.

## Out of scope
Renaming public API symbols; splitting projection.ts further (separate task if wanted).
