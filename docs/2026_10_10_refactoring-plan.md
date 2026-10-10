# Refactoring plan: API shape, types, consistency

Working state of the clean-up that started from the code review
[2026_10_10_api-extensibility.codereview.md](2026_10_10_api-extensibility.codereview.md). Written so
that a new session can pick it up without the conversation. Branch: `task/api-extensibility`.

## Done (committed)

| Commit | What |
|---|---|
| `f2913af` | Demo: the advanced example has an IronCalc spreadsheet `data/compile-times.ic` (+ `.ic.gen.typ`), built by `mise run fixtures:demo-spreadsheet`, shown as figure `<tab:runs>` in `chapters/results.typ` |
| `da5190e` | Tests: expectations for the new `<tab:runs>` label |
| `71c0f1a` | `Project.replace` tells listeners (a `delete` / `create` / `update` per file); every `refresh()` / `sync()` repair after it is gone |
| `29126aa` | `core/project` split by concept: `core/paths/` (naming, file kinds), `core/project/` (Project only, **no re-exports**), `core/document-links/` (`DocumentLinkProvider`, reading order); `calculateImportChange` + `TextChange` (leaf file `text-change.ts`) in `core/typst-document` |
| `a22fc3c` | Paths as types: `ProjectPath` / `PathReference`, branded strings, parsed at the edges (see ARCHITECTURE.md, "Paths") |

## In progress (uncommitted): remove change tracking entirely

The user decided: drop `base` / `baseLabel` / `setBase` **and every diffing feature** ("I have never
seen change tracking really working"). All references are already edited out (widget, element,
views, versions, `RoomVersions.base/onBaseChange`, preview change bars, `EditingViews.onCreate` /
`onBaseChange` / `cursor()`, `CollaborationLink.onSynced`, e2e specs, ARCHITECTURE.md,
embedding.md, demo-playground.md, `@codemirror/merge` in package.json).

Already deleted (staged): `src/features/changes/`, `src/typst-editor.changes.test.ts`,
`tests/e2e/changes.spec.ts`, `src/features/visual-view/change-decorations.ts`. Still to do (Claude's
sandbox refused the rest of `git rm`, and `pnpm install` fails there), so **the user runs**:

```
git rm -q src/features/visual-view/change-decorations.test.ts \
  src/features/preview/pages/change-bars.ts src/features/preview/pages/change-bars.test.ts
mise run deps:lock
```

Then: `mise run typecheck`, `mise run quality`, `mise run test:unit`, `mise run server:test`; fix
what remains; commit ("Remove change tracking …"). The server still keeps `meta.base` for its
three-way merge — that stays.

## Next steps, in order

1. **Public API clean-up** (`src/typst-editor.ts`, `src/typst-editor-element.ts`, docs/embedding.md,
   demo): remove `onChange(source)` (hosts use `onFilesChange`); `files` includes the main file
   (no "all but main" split); keep `source` as a documented shortcut to the main file's text;
   `<typst-editor>`: one `options` property (`Partial<TypstEditorOptions>`) spread into
   `createTypstEditor` plus the attribute-backed ones; its `change` event fires for every file
   with `{ path, content }`. (Review finding `typst-editor-element.ts:85`.)
2. **Remaining review findings** (see the review file for details):
   - `TypstNodeSpec` registry for the Visual view: schema node, call projector, printer, box /
     label flags, toolbar entries per construct; derive `BLOCK_CALLS`, `PRINT_BLOCK`, `RAW_TYPES`,
     `LABELLED_BLOCKS`, `callAtomType` from the list (blocker `projection.ts:467`).
   - Comments contribute `marginNote` / `noteRange` through that registry; `projection.ts` stops
     importing `features/comments` (blocker `projection.ts:53`).
   - `Widget`: a `fileViews: Record<FileKind, FileView>` registry (`show` / `hide`), features as
     internal `TypstExtension`s that get a small context and return `dispose` (`typst-editor.ts:170`).
   - `VisualViewOptions` → an `extensions` option (`visual-view.ts:22`).
   - Docblock on `VisualView.selection()` (`visual-view.ts:142`).
   - Addendum A: make private / delete: `Preview.setFollow`, `SourceView.setHighlights` + layers
     (or route diagnostics/presence through it), `TypstDocument.fromYText`, `ChangeTracking` gone
     already, `Layout.choose/isOpen`, `FileTree.setExpanded`, `FilePanel.element`,
     `ToolbarMenu.open/close/isOpen/trigger`, `StyleIndex.styles/onChange`; drop `export` of
     `HEADING_NUMBERING_RULE`, `referenceQuery`.
   - Addendum A blocker: `FILES_MAP` shared between server and client via `gitlab-protocol.ts`.
   - Addendum B: leaf files for `FileContent`/`ProjectFiles` and the engine result types
     (`TextChange` done).
   - Addendum C: `boxCarets` into `visual-view/nodes/`; `FieldPopover` into a feature-neutral
     `src/ui/field-popover/`; `files/icons.ts` into a leaf folder; tighten
     `eslint-rules/entry-imports.js` (no imports from ancestor folders); a folder-cycle check in
     `mise run quality`; a lint check against `export *` and re-exports of another module's API.
   - More value types (agreed order): `SourceOffset` vs ProseMirror `DocPosition` in the
     projection and views; then `PageIndex` (0-based) vs page number, `Pt` / `Px` in the preview.
3. **Lessons doc**: write `docs/2026_10_10_code-conventions.md` from "Decisions and conventions"
   below (refined), then **spawn subagents** (the user asked for it; workflow guideline < 10 agents)
   to check the rest of the codebase against it, one area each (core, visual-view, source-view +
   preview, files + collaboration + versions, widget + element + demo, server), and fix what they find.

## Decisions and conventions (from the user, binding)

- **APOSD** (Ousterhout): deep modules, information hiding, no pass-through layers. Don't split a deep
  class into shallow ones (Project stays one class; its change rules stay private methods).
- **Most important API at the top of a module**, with a *why* comment at the top of the entry file.
  Implementation details grouped in subfolders named after a concept (never `impl/`, `utils/`).
- **No re-exports of another module's API.** An entry file may export, by name, the interface of its
  *own* internal files; never `export *`. If a module needs to re-export something unrelated, the
  concept lives in the wrong module — split it (that is how `core/paths` and `core/document-links`
  came out of `core/project`).
- **VS Code API vocabulary and object-oriented style** where a concept matches
  (`DocumentLinkProvider.provideDocumentLinks`, `resolveDocumentLink`, `DocumentLink`, …). Rename the
  real classes and methods; never keep our own name with an "in VS Code terms" comment.
- **Names say what something does.** A function that computes a change without applying it says so:
  `calculateImportChange` (not `addImport`, `importEdit`, `scan…`). Avoid invented category words.
- **CQRS-like vocabulary is fine**: commands (`FileChange`, `TextChange`) go out; `onChange` events
  come back; indexes (`LabelIndex`, `StyleIndex`) are read models. A "calculate…" function is the
  decide step: pure, returns the command.
- **Value types instead of bare strings / numbers**: branded types (`string & { __type: 'X' }`) with a
  same-named companion object (`ProjectPath.parse/of/resolve/…`); parse at the edges (public API,
  Yjs, awareness, drag data, storage, engine results), typed everywhere inside. Plain-data DTOs that
  cross to the host / engine (`ProjectFiles`) may stay string-keyed.
- **Discriminated unions use `kind`** (as `FileChange`, `Jump`).
- **No "main file vs. the rest" special cases** in the public API (one general mechanism).
- **Notifications instead of manual repair**: a model tells its listeners about every change
  (`Project.replace`), so subscribers never need `refresh()`.
- Remove features that do not work rather than polish them.
- Tooling: every operation is a mise task; docs go in `docs/YYYY_MM_DD_slug.md`; commit per step on
  the task branch, all checks green before each commit.

## Environment notes for the next session

- Checks: `mise run typecheck`, `mise run quality`, `mise run test:unit`, `mise run server:test`.
  E2E (`mise run test:e2e`) only the user can run (Chromium does not start in Claude's sandbox).
- `mise run build:lib` fails in Claude's sandbox only: it cannot read lucide's `icons/vault.mjs`
  (sandbox rule on "vault" file names); not a code problem.
- The auto-mode permission check may refuse `git rm` / deleting files: ask the user to run it.
