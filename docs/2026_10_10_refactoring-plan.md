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
| `75f0fa5` | Change tracking removed (`base` / `setBase`, diff view, change bars, decorations, `@codemirror/merge`); server keeps `meta.base` |
| `9562c65` | Public API: `files` includes the main file, `source` is a documented shortcut, `onChange(source)` gone; `<typst-editor>` takes one `options` property, `change` fires per file with `{ path, content }` (a rename fires twice: old path `null`, new path content) |
| `bcfe4b1` | Docs: [extensions architecture](2026_10_10_extensions-architecture.md) |
| `698c971`..`fff6775` | Hosts wave (H1 visual-view, H2 source-view + preview, H3 workbench + extension API), merged and integrated: `ExtensionContext { subscriptions, project, workbench, visualView, sourceView, preview, services }`; one `Disposable` + `EventEmitter` in `core/`; the widget composes `builtinExtensions` in `src/typst-editor/typst-editor.ts`; `ui/` holds FieldPopover, ToolbarMenu, FloatingBar. Built-in modules still in `hosts/*/builtins/`, features still in `features/` |

## Next steps, in order

1. **Extensions architecture**: follow
   [2026_10_10_extensions-architecture.md](2026_10_10_extensions-architecture.md). Small hosts
   (`hosts/visual-view`, `source-view`, `preview`, `workbench`) with contribution points; every
   feature, and every Typst construct beyond the host's minimum, is an extension in
   `extensions/<name>/` with `model/` (no DOM) and one folder per host it contributes to. Its "Order
   of work" (hosts → slices → rules → value types) replaces the old wave plan; the remaining review
   findings are folded into it. **Hosts: done. Next: slices** (move `features/*` and
   `hosts/*/builtins/*` into `extensions/<name>/`).
   **After the slices merge: priority** (decided): `priority?: number` (default 100, higher first,
   Tiptap's semantics) on `registerNode` / `registerMark` / `registerBoxRenderer`; `group` + `order`
   for toolbar items, `alignment` + `priority` for status bar items; task lists and the image box
   renderer get 110; the "don't reorder" comment at `builtinExtensions` goes. Documented on every
   contribution point (see the architecture doc, "Priority").
   **After the slices merge: PDF export options** (decided by the user): ONE "Download PDF" button
   with an options popover, no button / menu entry per variant. Any extension adds options through
   the preview host: `preview.registerPdfExportOption({ id: '<ext>.<name>', label, default, apply(entry)
   → entry })` (checkboxes now; `choices` later), replacing `registerPdfVariant`. The pdf-export
   extension is the button + popover + export (applies every option to the compile entry); values
   remembered per viewer (`workbench.remember`). Public API: `exportPdf({ options: { 'comments.include':
   true } })` replaces `exportPdf({ comments })`. Comments only registers `comments.include`
   (default off); the `comments.exportPdf` command goes.
   **After the slices merge: presence out of the hosts** (decided by the user): the hosts'
   `PresenceTarget` / `setPresence` / `onDidChangePresence`, `TextEditor.setPresence` and the
   `Presence` types in `core/typst-document` are a pass-through for one extension. `Presence`,
   `PresenceTarget`, `PlacedPresence` → `extensions/collaboration/model/`; collaboration's view
   contributions subscribe to its own `RemoteCursors` (closure in `activate`, an `Event`) and draw via
   the hosts' generic points only (Visual decorations / highlights, Source CodeMirror extensions,
   `setBoxDecorations`, source↔pos mapping on the view context). Also sweep the hosts for other
   single-extension pass-throughs and remove them the same way.
   **After the slices merge: public extension API** (user: yes, now): `createTypstEditor({ extensions })`
   (the built-in list is the default; hosts can add their own, and replace or leave out built-ins),
   the extension types exported from `src/index.ts`, docs/embedding.md "Writing an extension" with an
   example. Async `executeCommand` (VS Code) before it goes public.
   **Rename `versions` → `source-control`** (user: "versions" is a bad name, it commits the state):
   VS Code's `SourceControl` concept; collaboration's GitLab room provides a `SourceControl` service
   (`commit(message)`, state, `onDidChange`) replacing `RoomVersions`; button label proposed
   "Save to GitLab…" (user to confirm).
2. **Value types** and the rules: see steps 3–4 of that doc.
3. **Rules wave also does:** core `onChange` → `onDidChange: Event` + `Disposable` everywhere
   (`Project`, `TypstDocument`, …) (user: yes).
4. **Lessons doc**: write `docs/2026_10_10_code-conventions.md` from "Decisions and conventions"
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
- **The main agent only plans and merges**; every refactoring runs in subagents (Workflow), in
  parallel where the files are disjoint (worktrees), merged and checked by the main agent.
- **Module boundary = the extension / host / core folder, not every folder** (user, 2026-10-10:
  "entry named after its folder" is a guideline, not a 100% rule). Outside code imports only the
  module's entry (`extensions/labels/labels.ts`); inside a module, layer and concept folders
  (`model/`, `visual-view/`, `projection/`, …) have no entry files of their own and files import each
  other directly (`./model/label-index`). No thin re-exporting entries like `model/model.ts`. Inside a
  module the layer direction still holds (`model/` imports no view folder, no DOM). Entry names follow
  the folder where that reads well; the lint checks "only through the entry", not the file name.
  Implemented in the rules wave (`eslint-rules/entry-imports.js`).
- **Re-exports as few as possible** (user, 2026-10-10: "they greatly increase complexity"). A module's
  entry *defines* its API (the most important code lives in the entry, not behind it); internal files
  hold the implementation and are not forwarded. `export … from` / `export { x }` of an imported name
  is allowed only in the package entry `src/index.ts`; anywhere else it is a lint error, with a short,
  reasoned exception list in `eslint.config.js` that should shrink. If an outside caller needs an
  internal name, first ask whether the caller or the boundary is wrong (move the code, or the concept
  is its own module). Implemented in the rules wave; the agents' thin entries (`model/model.ts`, …) and
  host entries re-exporting built-ins / toolkits go.
- **No sibling folders**: a module's entry file lives inside its folder (`typst-editor/typst-editor.ts`),
  never next to it. Code that is a feature lives in `features/`, even if only the widget uses it.
- Tooling: every operation is a mise task; docs go in `docs/YYYY_MM_DD_slug.md`; commit per step on
  the task branch, all checks green before each commit.

## Environment notes for the next session

- Checks: `mise run typecheck`, `mise run quality`, `mise run test:unit`, `mise run server:test`.
  E2E (`mise run test:e2e`) only the user can run (Chromium does not start in Claude's sandbox).
- `mise run build:lib` fails in Claude's sandbox only: it cannot read lucide's `icons/vault.mjs`
  (sandbox rule on "vault" file names); not a code problem.
- The auto-mode permission check may refuse `git rm` / deleting files: ask the user to run it.
