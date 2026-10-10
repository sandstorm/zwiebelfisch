# TODO — task files for parallel work

Each `*.md` here is one self-contained task that an agent (or a human) can pick up independently.
Read [ARCHITECTURE.md](../../ARCHITECTURE.md) and the [concept](../2026_10_10_concept.md) first.

## Format of a task file

```
# <title>
Status: open | in-progress (<who>, <date>) | done (<commit>)
Depends on: <other task files or "nothing">
Touches: <paths this task is expected to change — keep overlaps with other open tasks small>

## Goal            what and why, user-visible outcome
## Context         relevant files, prior art, constraints
## Acceptance      checkable criteria (tests that must exist and pass)
## Out of scope    what NOT to do here
```

## Rules for working on a task

- Set `Status: in-progress` when you start, `done (<sha>)` when it is merged.
- Follow the repo rules: tools and scripts only via mise (`mise run …`, exact version pins, new
  scripts as files in `mise-tasks/`); TDD (vitest for logic, Playwright for UI behaviour);
  APOSD deep modules; run `mise run quality` and the `code-quality` skill before committing.
- Small, focused git commits. Update ARCHITECTURE.md when you change a module contract.
- Sandbox note: agents cannot launch Chromium or bind ports. Write Playwright specs anyway and
  say in the final report that they need to be run by the user (`mise run test:e2e`).

## Index

| Task | Status |
|---|---|
| [engine-wasm-size](engine-wasm-size.md) | done (21 MB raw / 8 MB gzip; rest is typst-library) |
| [visual-view-projection](visual-view-projection.md) | done |
| [diagnostics-ui](diagnostics-ui.md) | done |
| [web-component-and-library-build](web-component-and-library-build.md) | done |
| [multi-file-assets-packages](multi-file-assets-packages.md) | done |
| [tiptap-migration](tiptap-migration.md) | done |
| [projection-position-map](projection-position-map.md) | done |
| [comments](comments.md) | done (superseded by comments-drafting) |
| [diff-rendering](diff-rendering.md) | done |
| [multi-file-ui](multi-file-ui.md) | done |
| [visual-view-toolbar-and-raw-editing](visual-view-toolbar-and-raw-editing.md) | done |
| [visual-view-links-images-tables](visual-view-links-images-tables.md) | done |
| [visual-view-compiled-boxes](visual-view-compiled-boxes.md) | done |
| [preview-ux](preview-ux.md) | done |
| [collab-yjs](collab-yjs.md) | done |
| [server-gitlab](server-gitlab.md) | done |
| [followups-2026-10-10](followups-2026-10-10.md) | open |
| [diff-redline-palimset](diff-redline-palimset.md) | open |
| [restructure-src](restructure-src.md) | done (branch task/restructure-src) |
| [inspector-sidebar](inspector-sidebar.md) | open (concept; dockview spike: adopt later) |
| [e2e-preview](e2e-preview.md) | done (branch task/e2e-preview) |
| [e2e-visual](e2e-visual.md) | done (branch task/e2e-visual) |
| [fix-image-upload-ui](fix-image-upload-ui.md) | done (branch task/fix-image-upload-ui) |
| [demo-examples](demo-examples.md) | done (branch task/demo-examples) |
| [visual-toc-and-code](visual-toc-and-code.md) | done (branch task/visual-toc-and-code) |
| [concept-custom-styles](concept-custom-styles.md) | done (concept: docs/2026_10_10_custom-styles.md) |
| [custom-styles-mvp](custom-styles-mvp.md) | open |
| [visual-figures-resize](visual-figures-resize.md) | done (branch task/visual-figures-resize) |
| [visual-text-align](visual-text-align.md) | done (branch task/visual-text-align) |
| [comments-drafting](comments-drafting.md) | done |
| [visual-block-nodes](visual-block-nodes.md) | done (branch task/visual-block-nodes) |
| [demo-playground](demo-playground.md) | done (branch task/demo-playground) |
| [comments-gutter](comments-gutter.md) | done (branch task/comments-gutter) |
| [collab-markers](collab-markers.md) | done (branch task/collab-markers) |
| [comment-replies](comment-replies.md) | done (branch task/comment-replies) |
| [notes-pdf](notes-pdf.md) | done (branch task/notes-pdf) |
