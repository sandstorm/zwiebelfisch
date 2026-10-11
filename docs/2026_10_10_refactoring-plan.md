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
| `1245fc5`..`79bd3d1` | Slices merged: 21 extensions in `src/extensions/`, `features/` and `hosts/*/builtins/` gone; `src/testing/` (test-only composition); `registerStyleSheet` + per-extension CSS; `core/uploads`, `core/gitlab-protocol`; `{ priority }` on registerNode / registerMark / registerBoxRenderer |
| `d4641ef`..`4cf2443` | Wave 1: presence out of core + hosts; `registerDocumentLinkProvider` (merged, priority) read by both views; `preview-sync`; no services (`registerFileDecorationProvider`, `registerSourceControl`, `versions` → `source-control`, "Save to GitLab…"); one "Download PDF" + options popover, `registerPdfExportOption`, `exportPdf({ options })`; IronCalc dark mode (palette from tokens, resize nudge redraws the canvas) |
| `6f11f47`..`2399f41` | Wave 2: public extension API `createTypstEditor({ extensions: (builtins) => [...], settings })`; settings via `contributes.configuration` + `workspace.getConfiguration` (`pdfExport.download`, `files.panel`, `previewSync.followCursor`, `workbench.theme`); string async commands; `<typst-editor settings='{…}'>` thin adapter; preview toolbar `group` + `order`; UI services: messages, `showInputBox` / `showQuickPick` (FieldPopover deleted), `registerMenuItem` (`editor/title`, `file/newFile`, `explorer/context`) |
| `23a1013`..wave-3 merge | Wave 3: custom editors (`registerCustomEditorProvider(viewType, provider, { filenamePattern, priority })`, `FileKind` gone → `ProjectPath.isTypst`); `diagrams` extension (`.drawio.png` in embedded diagrams.net, auto-save, dark mode, "New diagram…", "Edit diagram" via generic `registerBoxAction`); "New spreadsheet…"; one `PdfEntry` in `core/typst-engine`; status bar `alignment` + `priority`; source-control wiring test; collab e2e checks file decorations |
| `7938ea3`..`cfe3430` | Rules wave: events `onDid…: Event`; Yjs out of core (collaboration's `TextBinding`, per-user undo in collaboration); `Highlight` → visual-view host; `core/typst-syntax`, `core/typst-packages`, `core/engine-assets`, `hosts/projection`; no DOM in core (lint); module boundaries (20 thin entries gone); re-exports 275 → 0 outside `src/index.ts` (`local/no-re-exports`); layer lint (`local/dependencies`); `quality:module-cycles` |
| `76753ac`..`c103841` | Conventions doc + sweep: 8 agents, ~70 small fixes merged; findings needing decisions in [2026_10_11_sweep-findings.md](2026_10_11_sweep-findings.md) |

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
   **Same agent: document links in VS Code's shape** (user: merging sounds sensible): one
   `workbench.registerDocumentLinkProvider({ provideDocumentLinks(document) → DocumentLink[] (range,
   target?, tooltip?), resolveDocumentLink?(link) }, { priority? })` read by BOTH views (Source view
   and the Visual view's boxes; no separate box-links route); links of all providers are merged,
   overlapping ranges → higher priority wins. The `document-links` extension is one provider (open, or
   create a missing .typ); `core/document-links` keeps only Typst-syntax finding + reading order.
   Replaces `sourceView.registerLinkProvider` (factory returning a whole provider, first one wins).
   **Same agent: editor ↔ preview sync as an extension** (user: "shouldn't this be an extension?"):
   the preview host keeps only mechanism: `reveal(path, from, to)`, hit-testing, `onDidClickPage`
   (with the source position). A `preview-sync` extension owns the policy both ways: follow cursor
   (listens to `onDidChangeTextEditorSelection`, calls `reveal`), its toolbar switch + remembered
   state, and click-in-preview → jump to source (today's `onJump` option). Without it the preview
   neither follows nor jumps. `previewControls` keeps zoom + page number.
   **Same agent: no services, no declaration merging** (user: "really needed?"): `labels` / `styles`
   services are never read (delete); `documentLinks` goes with the generic link providers;
   `collaboration` → `workbench.registerFileDecorationProvider` (presence dots in the file tree, VS
   Code's FileDecorationProvider) + a workbench `SourceControl` registry (VS Code's
   `scm.createSourceControl`: the GitLab room registers one, the `source-control` extension is only
   the UI). Then `ServiceRegistry` / `Services` / `context.services` go. Commands: plain string ids,
   `executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T>` (no `CommandRegistry`).
   Rule: an extension that needs something from another gets a generic host contribution point,
   never a dependency. (`declare module '@tiptap/core'` for Tiptap commands stays: Tiptap needs it.)
   **After the slices merge: public extension API** (user: yes, now): `createTypstEditor({ extensions })`
   (the built-in list is the default; hosts can add their own, and replace or leave out built-ins),
   the extension types exported from `src/index.ts`, docs/embedding.md "Writing an extension" with an
   example. Async `executeCommand` (user: yes): returns `Promise<Awaited<CommandResult<K>>>`, but calls
   the handler synchronously (`Promise.resolve(handler(...))`, so user activation, selection and
   focus behave as today); a throwing handler / unknown id rejects; the keybinding path decides
   `preventDefault` synchronously and `catch`es + logs.
   **Rename `versions` → `source-control`** (user: "versions" is a bad name, it commits the state):
   VS Code's `SourceControl` concept; collaboration's GitLab room provides a `SourceControl` service
   (`commit(message)`, state, `onDidChange`) replacing `RoomVersions`; button label proposed
   "Save to GitLab…" (user to confirm).
   **After the slices merge: IronCalc dark mode** (user asked; small, own agent): IronCalc 0.8.3 has
   no dark preset but `setThemeVariables(vars, target)` (~60 CSS variables: palette, greys, sheet
   grid / headers / default text / outline). The spreadsheets extension sets a dark palette derived
   from the widget's color tokens while `data-scheme="dark"`, and follows scheme changes (check
   whether the canvas redraws on its own or needs a nudge). Cell colors set in the file stay.
   **After the slices merge: draw.io diagrams** (user asked): see
   [todo/drawio-diagrams.md](todo/drawio-diagrams.md): `extensions/diagrams/`, `.drawio.png` in the
   embedded diagrams.net editor, auto-save (autosave → export xmlpng → project update, debounced).
   Brings VS Code's custom editors: `registerCustomEditorProvider(viewType, provider, {
   filenamePattern, priority })` replaces `registerFileView(kind)`; `registerNewFileTemplate` for
   "New diagram…" / "New spreadsheet…". Runs after the IronCalc dark-mode agent or merges after it
   (both touch spreadsheets' registration).
   **Decided 2026-10-10 (user), generic mechanisms after the slices merge:**
   - *Configuration* (with the public extension API agent): extensions declare settings (id, type,
     default, description); read via `workspace.getConfiguration('<ext>').get('<key>')` +
     `onDidChangeConfiguration`; `createTypstEditor({ settings })` (and the element's attributes, if
     it stays) map onto it generically — no hand-wired per-feature options (`pdfDownload`,
     `fileList`, `user`, `followCursor`, …) in `typst-editor.ts`.
   - *Workbench UI services* (one agent, after the public API): `showInformationMessage` /
     `showWarningMessage` / `showErrorMessage`; `showInputBox` / `showQuickPick` (replace per-feature
     `FieldPopover` uses: label names, link URL, commit message, new style); menus as contribution
     points `registerMenuItem(menuId, { command, when?, group, order })` for the file panel context
     menu, "New …" entries, tab bar actions (replaces the planned `registerNewFileTemplate`).
   **Rules wave also does (core cleanup, user decided):** Yjs out of `TypstDocument` (`share`,
   `fromYText`, `y-delta`, `REMOTE_ORIGIN` → collaboration binds a Y.Text from outside, like
   y-codemirror; verify undo + origins); `FileKind` reduced to Typst vs. other (editors by filename
   pattern), MIME table + `imageBlob` → images; `Highlight` → hosts; `core/typst-syntax/` holds the
   path finder, `calculateImportChange`, reading order; engine test packages next to their tests.
   **`<typst-editor>` stays as a thin generic adapter** (user): shadow root + `createTypstEditor`;
   `setting-*` attributes map onto settings generically; editor events forwarded as DOM events; no
   per-option code (with the configuration work).
   **Later (after draw.io brings custom editors): Visual / Source as the two built-in editors for
   `*.typ`** (user: makes sense architecture-wise). They stay *hosts* with contribution points (like
   VS Code's built-in text editor), only registered through the custom-editor mechanism so the tabs
   become the generic "open with" switch. Extension layout is unchanged:
   `extensions/document-links/{source-view,visual-view}/` keep contributing to those hosts.
   **Open, for the user (by eye / e2e):** IronCalc dark palette; new file panel (Rename / Delete in
   the context menu); "Upload image…" after the quick pick (Safari); the real diagrams.net embed URL
   parameters (`noSaveBtn`, `saveAndExit=0`, `dark=1`) and export reply; e2e specs changed in waves
   1–3 (pdf-download, gitlab, web-component, multi-file-ui, image-upload, margin-notes, visual-*,
   collab, spreadsheets, diagrams).
   **Text files + fallback** (user, 2026-10-11; right after the API-shape wave, parallel to its
   follow-up): a `text-files` extension — `.csv`, `.json`, `.yaml` / `.yml`, `.toml`, `.xml`, `.bib`,
   `.txt`, `.md` open editable in plain CodeMirror (no new language packages; highlighting later),
   saved as file updates (collaboration: whole file, last save wins, as images). The read-only
   fallback for every other file (`*`: name, size, type) moves from `images` to the `files`
   extension; `images` keeps only `images.preview`.
   **Documentation as Typst** (user, 2026-10-11; replaces the README-per-area idea): all
   documentation is one Typst project in `docs/`; Markdown only for a rudimentary root `README.md`.
   `docs/main.typ` + `template.typ` (tiny); Part 1 `guide/` (getting-started, embedding, features,
   collaboration), Part 2 `extensions/` (overview with the five vocabularies, workbench API,
   visual-view constructs, source-view and preview), Part 3 `architecture/` (overview with layers +
   a keystroke's journey, core, projection, visual-view, source-view, preview, workbench,
   built-in-extensions, server, conventions, development). Each Part-3 chapter one page: job, 3–6
   concepts, how they connect. Cross-references as Typst labels; code top comments point to the
   chapter (`See docs/architecture/workbench.typ`, enforced by the top-comments check). The demo
   gets a "Documentation" example loading `docs/**/*.typ` (edit live, nothing saved);
   `mise run docs:pdf` (the book) and `mise run docs:html` — Typst 0.15's **bundle export** (we pin
   0.15.1, CLI and engine): one HTML page per chapter via `document("<part>/<chapter>.html")[…]`, an
   index page with the outline, images / diagrams copied with `asset(…)`; the same chapters drive the
   PDF, the bundle and the demo (`target()` or a small `site.typ` entry, whichever is more obvious);
   paged-only styling behind `target()`. **Style (user):** concise and easy to digest — short
   sentences, bullet lists, tables, a code example instead of a paragraph; no filler, no
   introductions that restate the heading, no "this chapter explains…", no summaries at the end, no
   marketing adjectives. If a sentence can go without losing information, it goes. The skeleton agent first verifies the exact 0.15.1 CLI flags
   and whether cross-page `@label` references link (else plain links between pages). Diagrams: draw.io
   (`.drawio.png`, edited with our own diagrams extension) or mermaid / d2 later; ASCII in raw
   blocks until then. Working notes (dated plans, research, code review, findings, `docs/todo/`)
   are distilled into the Typst docs, then deleted (this plan last, when the refactoring is done);
   `ARCHITECTURE.md` and `docs/embedding.md` go once their content lives there. Runs after the
   follow-up merge: a skeleton agent (main, template, demo example, docs:pdf), then writers per
   part in parallel, then an integrator (top comments, deletions, README). Later waves update the
   docs in the same commit as the code.
   **Demo checklist (user, 2026-10-11):** `docs/demo-playground.md` shrinks to a few lines in the
   root `README.md` — only how to run the demo (and its examples); the long manual checklist goes,
   not into the Typst docs. The CSS wave was briefed to move it into `architecture/development.typ`;
   correct that after its merge. `mise run demo` depends on the font build (task dependency).
   **Later: what do features cost?** (user, 2026-10-11; after the current waves) Per extension and
   per host: lines of code (source vs. tests), complexity (the code-quality metrics: cyclomatic /
   cognitive hot spots), dependencies (hosts / core modules and contribution points used, runtime
   couplings such as schema names or commands), tests and e2e specs touching it. One ranked table
   ("most expensive first") with a note per row on what makes it expensive — the basis for deciding
   what to simplify or cut. Analysis only, by a subagent; no code changes.
2. **Value types** and the rules: see steps 3–4 of that doc.
3. **Rules wave also does:** core `onChange` → `onDidChange: Event` + `Disposable` everywhere
   (`Project`, `TypstDocument`, …) (user: yes).
4. **Lessons doc** (written: [2026_10_11_code-conventions.md](2026_10_11_code-conventions.md)): write it from "Decisions and conventions"
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
