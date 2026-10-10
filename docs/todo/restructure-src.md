# Restructure src/: entry points on top, internals in subfolders

Status: open — start after task/comments-drafting, task/visual-block-nodes and task/demo-playground are merged.
Depends on: those three (renames would conflict with them)
Touches: everything under src/, crates/ (moves), tsconfig/vite/eslint config, mise-tasks (engine build paths), ARCHITECTURE.md, docs/embedding.md

## Goal
Make it obvious, when you open a folder, what is API and what is internal (user decision, 2026-10-10):
- **The files directly in a folder are its entry points** (usually one). Everything internal goes
  into subfolders. File trees list folders first, so the entry point stands out in every folder.
- **Imports may reach a folder's direct files, never its subfolders.** Enforce it with an ESLint
  boundary rule (e.g. `no-restricted-imports` patterns, or eslint-plugin-boundaries, exactly pinned).
- **Every file starts with a top comment:** either the context, or `See <nearest concept>` (the
  entry file, or an ARCHITECTURE.md section). Add a check to `mise run quality`.
- The most important API is on top: `src/typst-editor.ts` (createTypstEditor).

## Target layout
```
src/
  typst-editor.ts            createTypstEditor (was editor/typst-editor.ts)
  typst-editor-element.ts    <typst-editor> (was element/)
  index.ts
  wiring/                    editing-views, project-renderings, collaboration-link, styles.css
  core/
    typst-document/          typst-document.ts; parts/ (highlight, minimal-change, y-delta)
    typst-engine/            typst-engine.ts (was engine/engine.ts); rust/ (was crates/typst-engine);
                             wasm/, fonts/ (generated); parts/ (packages, tar, default/fetch fonts); fixtures/
    project/                 project.ts; parts/ (paths)
  features/
    visual-view/             visual-view.ts; projection/, nodes/, toolbar/, decorations/
    source-view/             source-view.ts; parts/ (lint, typst-language)
    preview/                 preview.ts; worker/ (engine.worker, protocol, project-files); pages/ (…)
    diagnostics/             diagnostics-status.ts; parts/ (summary)
    changes/                 change-tracking.ts; parts/ (diff)
    comments/                drafting margin notes
    files/                   file-switcher.ts, asset-view.ts; parts/ (upload, insert-image)
    collaboration/           collaboration.ts, gitlab-protocol.ts (server imports it); parts/ (…)
    versions/                version-controls.ts
```
Current leaks to fix while moving: `preview/project-files`, `visual-view/field-popover`,
`source-view/typst-language` are imported from other folders. They either become entry files or
the callers go through the entry.

## Acceptance
- `git mv` for all moves (history follows); no behaviour change; vitest, typecheck, quality green;
  `mise run build`, `build:lib`, `build:engine` work with the new paths; the server's import of
  gitlab-protocol works.
- The ESLint boundary rule fails on an import into another folder's subfolder (prove with a test fixture or a note).
- The top-comment check fails on a file without one; every file has one.
- ARCHITECTURE.md follows the new tree, entry points first; docs/embedding.md paths updated.

## Out of scope
Renaming public API symbols; splitting projection.ts further (separate task if wanted).
