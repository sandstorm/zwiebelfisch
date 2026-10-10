# Code conventions

The rules this codebase follows, distilled from the refactoring of 2026-10-10/11
([refactoring plan](2026_10_10_refactoring-plan.md), [extensions architecture](2026_10_10_extensions-architecture.md)).
ARCHITECTURE.md describes *what* is where; this file says *how* code is written. Lint enforces what it
can (`mise run quality`); the rest is for authors and reviewers.

## 1. Design (APOSD)

- **Deep modules.** A module hides a lot behind a small interface. Don't split a deep class into
  shallow ones (`Project` stays one class; its change rules stay private methods).
- **Information hiding.** Expose what callers need, nothing for tests' or one caller's convenience.
  A public member used only by tests is a smell; test through the real interface.
- **No pass-through layers.** A layer that forwards something for one consumer goes. Typical case: a
  host that receives data from one extension only to hand it back to that extension (presence,
  follow-cursor state, link factories, PDF variants were all removed for this).
- **The most important API at the top** of a file, with a *why* comment at the top of the entry.
- **Remove what does not work** rather than polish it (change tracking was removed).

## 2. Modules and folders

- **A module** is `core/<name>/`, `hosts/<name>/`, `extensions/<name>/`, `ui/<name>/`,
  `typst-editor/`, `typst-editor-element/`, `testing/`. From outside, only its **entry file** may be
  imported. Inside, subfolders are layer or concept folders (`model/`, `visual-view/`, `projection/`)
  without entries of their own; files import each other directly.
- **The entry defines the API.** The most important code lives in the entry, not behind it.
- **No re-exports** (`export … from`, forwarding an imported name) except in `src/index.ts`, the
  package entry. If an outside caller needs an internal name, the caller or the boundary is wrong:
  move the code, or the concept is its own module (that is how `core/typst-syntax`,
  `core/typst-packages`, `hosts/projection` came about).
- **No sibling folders**: an entry lives inside its folder (`typst-editor/typst-editor.ts`).
- **Folders are named after a concept**, never `utils/`, `impl/`, `helpers/`. Entry names follow the
  folder where that reads well (a guideline, not a rule).
- **No cycles between modules** (`mise run quality:module-cycles`).

## 3. Layers

| Layer | May use | Must not |
|---|---|---|
| `core/` (model) | other `core/` modules | DOM, editor libraries, Yjs, anything outside core |
| `ui/` | DOM, `core/` | hosts, extensions |
| `hosts/` (mechanism + contribution points) | DOM, editor libraries, `core/`, `ui/` | extensions, `typst-editor/`, `testing/` |
| `extensions/<name>/` (features, policy) | hosts' entries, `core/`, `ui/` | other extensions |
| `extensions/<name>/model/` | `core/` | DOM, editor libraries, the extension's view folders |
| `typst-editor/`, `typst-editor-element/` | everything's entries | — |
| `testing/` | everything | being imported by non-test code |

- **The line between model and view is the DOM.** Pure display logic (layout of cards, zoom presets,
  tree rows) is model.
- **Hosts keep only mechanism.** For every host member ask: *mechanism, or one feature's policy?*
  Policy is an extension (following the cursor, drawing other users' carets, which PDF options exist).
- **Extensions never depend on each other**, not through imports, not through a service registry.
  When one has something for another, a host offers a **generic contribution point** any extension
  may use, and the consumer reads every contribution (document link providers, file decoration
  providers, source controls, PDF export options, menus).

## 4. Extension API (VS Code's vocabulary and shapes)

- Use VS Code's names where a concept matches, and rename our own classes and methods to them; never
  "our name, in VS Code terms …" comments: `activate`, `subscriptions`, `Disposable.dispose()`,
  `register…Provider`, `provide…` / `resolve…`, `onDid<Verb>`, `executeCommand`,
  `getConfiguration`, `showInputBox`, `showQuickPick`, `show…Message`, `registerMenuItem` with
  `editor/title` / `explorer/context` / `file/newFile`, `registerCustomEditorProvider`,
  `registerSourceControl`, `StatusBarItem` alignment + priority.
- **Contributions are registered once, at activation**; hosts apply them to every view they create
  later. Everything registered returns a `Disposable` pushed to `context.subscriptions`.
- **Competing contributions** are decided by an explicit tie-breaker, never by registration order
  alone: `priority` (default 100, higher first, Tiptap's semantics) for nodes, marks, box renderers,
  link providers, PDF options, custom editors; `group` + `order` for toolbar and menu items;
  `alignment` + `priority` for the status bar; CodeMirror's `Prec` in the Source view.
- **Events**: `readonly onDid<Verb>: Event<T>`; subscribing returns a `Disposable`. Never an
  `onChange(listener) → unsubscribe` function. Option callbacks passed in (`onFilesChange`) are fine.
- **Commands**: plain string ids `<extension>.<verb>`; `executeCommand<T>(id, ...args): Promise<T>`;
  the handler is called synchronously (user activation, selection and focus stay intact).
- **Settings**: declared in `contributes.configuration` (`<extension>.<key>`, type, default,
  description), read with `workspace.getConfiguration`, followed with `onDidChangeConfiguration`.
  No per-feature options in `createTypstEditor`; widget options are only content and host wiring.
- **CSS**: an extension brings its own `<name>.css` and registers it (`registerStyleSheet`); class
  names of its own; colors from the `--te-*` tokens so light and dark both work.
- **Talking to the user** goes through the workbench (`show…Message`, `showInputBox`,
  `showQuickPick`), not hand-made popovers.

## 5. Naming and types

- **Names say what something does.** A function that computes a change without applying it says so:
  `calculateImportChange` (not `addImport`). No invented category words.
- **CQRS-like vocabulary**: commands (`FileChange`, `TextChange`) go out, `onDid…` events come back,
  indexes (`LabelIndex`, `StyleIndex`) are read models; a `calculate…` function is the pure decide step.
- **Value types instead of bare strings / numbers**: branded types (`string & { __type: 'X' }`) with a
  same-named companion object (`ProjectPath.parse / of / resolve`). Parse at the edges (public API,
  Yjs, awareness, drag data, storage, engine results); typed everywhere inside. Plain DTOs that cross
  to the host or the engine may stay string-keyed.
- **Discriminated unions use `kind`.**
- **No "main file vs. the rest" special cases** in the API; one general mechanism.
- **Notifications instead of manual repair**: a model tells its listeners about every change, so
  nobody needs `refresh()`.

## 6. Comments and tests

- Every source file starts with a comment: its context and `See <entry / ARCHITECTURE.md section>`,
  or `Tests for X` (`mise run quality:top-comments`).
- Comments say *why*, or what a name cannot; no history ("was …", "moved from …"), no restating code.
- Tests go through the public interface of their module; model tests run without jsdom.
- Host tests use the host's own minimum plus specs defined in the test; tests that need the whole
  widget live in `typst-editor/` or use `testing/`.

## 7. Process

- Every operation is a mise task (`mise run typecheck`, `quality`, `test:unit`, `server:test`,
  `test:e2e`). Commit per step; all checks green before each commit.
- Research and concepts go in `docs/YYYY_MM_DD_slug.md`; todos in `docs/todo/`.
