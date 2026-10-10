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
| [multi-file-assets-packages](multi-file-assets-packages.md) | open |
| [tiptap-migration](tiptap-migration.md) | done |
| [projection-position-map](projection-position-map.md) | open |
| [comments](comments.md) | open (after position map) |
| [diff-rendering](diff-rendering.md) | open (after position map) |
| [multi-file-ui](multi-file-ui.md) | open (after multi-file-assets-packages) |
| [visual-view-toolbar-and-raw-editing](visual-view-toolbar-and-raw-editing.md) | open (after projection) |
| [preview-ux](preview-ux.md) | open |
| [collab-yjs](collab-yjs.md) | open (later) |
| [server-gitlab](server-gitlab.md) | open (later) |
