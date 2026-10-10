# Restructure src/: entry points on top, internals in subfolders

Status: done (branch task/restructure-src)
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

## Outcome
All moves are `git mv`; no behaviour change (demo bundles compared before/after: the same code apart
from module order and generated names). One fix on the way: an unclosed `.typst-toolbar__style`
rule in the stylesheet made `mise run build` / `build:lib` fail on the `@keyframes` after it.

Final tree (entry files first; `core/` and `features/` only group):
```
src/
  index.ts  typst-editor.ts  typst-editor.css  typst-editor-element.ts
  typst-editor/            editing-views, project-renderings, collaboration-link (typst-editor.ts only)
  typst-editor-element/    inline-source (typst-editor-element.ts only)
  core/
    typst-document/        typst-document.ts; highlight, presence, minimal-change, y-delta
    typst-engine/          typst-engine.ts; engine-assets, fetch-fonts; packages/packages.ts (+ tar);
                           fixtures/; generated wasm/, fonts/
    project/               project.ts; paths
  features/
    visual-view/           visual-view.ts, visual-view.css; field-popover, highlights, change-decorations,
                           presence, test-support
      projection/          projection.ts; raw-code, alignment, call-atoms
      nodes/               nodes.ts (was extensions.ts); raw-box, rendered-box, code-block-view, page-break,
                           horizontal-rule, task-list, checklist-preamble, heading-numbers, heading-numbering,
                           numbering, text-align, margin-notes
      images/              images.ts (new); image-call, image-choices, image-edits, image-insertion, image-tools
      toolbar/             toolbar.ts; toolbar-action, toolbar-blocks
      notes-gutter/        notes-gutter.ts; note-list, card-layout
    source-view/           source-view.ts; typst-language, lint, presence
    preview/               preview.ts; toolbar, latest-only
      worker/              worker.ts (new: startEngineWorker); engine.worker, protocol, project-files
      pages/               pages.ts (new); page-list, geometry, zoom, snippet, change-bars, presence-markers
    diagnostics/           diagnostics.ts (was diagnostics-status.ts); diagnostics-summary
    changes/               changes.ts (was change-tracking.ts), changes.css; diff
    comments/              comments.ts (was comment-action.ts); add-margin-note, margin-note-syntax, page-margin
    files/                 files.ts (was file-switcher.ts); asset-view, upload, insert-image
    collaboration/         collaboration.ts; gitlab-protocol, in-process, shared-project, shared-assets,
                           remote-cursors, room-versions
    versions/              versions.ts (was version-controls.ts)
```
Class names stay (`DiagnosticsStatus`, `ChangeTracking`, `CommentAction`, `FileSwitcher`,
`VersionControls`).

Boundary rule: `local/entry-imports` (`eslint-rules/entry-imports.js`, proven by
`eslint-rules/entry-imports.test.js`), part of `mise run quality`. Exceptions, listed once in
`eslint.config.js` (`boundaries.exceptions`):
- `features/collaboration/gitlab-protocol.ts`: anyone (server/; features/versions must not load the
  lazily loaded collaboration chunk);
- `core/typst-engine/engine-assets.ts`: `features/preview/preview.ts` only (asset URLs; in the
  entry, the worker bundle, which imports the entry, would emit every asset a second time);
- `features/collaboration/in-process.ts`: test files;
- `features/collaboration/shared-project.ts`: the server's tests.

Top comments: `mise-tasks/quality/top-comments` (src/, demo/, tests/, server/src/, eslint-rules/),
a dependency of `mise run quality`.

Deviations from the suggested layout:
- No `source-view/language/` and no `typst-document/yjs/`: a subfolder needs an entry file named
  like it, and two files (resp. one) do not make one; they stay flat.
- No `visual-view/decorations/` or `testing/`: highlights, change-decorations, presence and
  test-support sit at the visual-view root (a folder's internals are open to its subfolders).
  margin-notes.ts is a node (nodes/); notes-gutter/ is new (notes-gutter, note-list, card-layout);
  image-call went to images/, numbering to nodes/ (heading numbering is its only user).
- `jsdom-setup.ts` became a vitest setup file (`tests/jsdom-setup.ts`, a no-op outside jsdom)
  instead of an import from other folders' tests.
- `preview/latest-only.ts` stays at the preview root (main-thread scheduling, not the worker).
- `FileContent` moved from preview/project-files to core/project (core imports no feature).
- `engine/default-fonts.ts` became `typst-engine/engine-assets.ts` and also holds the wasm URL.
- `element/inline-source.ts` went beside the element (`typst-editor-element/`) rather than into
  it, so its test does not import the whole widget.
- The Visual view reads `margin-note-syntax.ts` through `comments.ts`.
