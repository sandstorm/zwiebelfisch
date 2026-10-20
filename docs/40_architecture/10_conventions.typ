#import "../template.typ": unreviewed

= Conventions <architecture-conventions>

#unreviewed

How code is written here. `mise run quality` checks what it can (@architecture-development); reviewers check the rest.

== Design <architecture-conventions-design>

- *Keep overall complexity low*, measured in obviousness, not lines. Every type, helper or contribution point of ours is a concept someone must learn; prefer the frameworks' concepts and plain code.
- *New concepts of ours only where two areas meet*: Typst ↔ ProseMirror (`hosts/visual-editor/typst-conversion`), Typst ↔ CodeMirror (raw boxes), our extension API ↔ a framework. Inside one area, use its own.
- *Propose every new concept to the user first*, with what it replaces and brings. Renames, moves and plain functions are not new concepts.
- *Deep modules* (_A Philosophy of Software Design_): much hidden behind a small interface. Don't split a deep class into shallow ones (`Project` stays one class).
- *Information hiding*: expose what callers need; no member exists only for tests or one caller's convenience.
- *No pass-through layers*: a host does not take data from an extension only to hand it back.
- *Files read general to specific*: the main element (the export the file is named after), the other exports, then private helpers in order of use. A constant needed while the module loads sits directly above its user.
- *Remove what does not work* rather than polish it.
- *Editing stays inline*: popovers, tags and bars at the content, as in Notion. No inspector panel.

== Modules and folders <architecture-conventions-modules>

- *Code lives in the highest layer that can hold it* (extension, then host, then core), next to its consumers: a host function only one extension uses goes into that extension. `core/` holds only what models need or many share.
- *A module* is `core/<name>/`, `hosts/<name>/`, `extensions/<name>/`, `editor/`, `editor-element/` or `testing/`; from outside, import only its *entry file*.
- *A sub-module* is a subfolder listed in `subModules` (eslint.config.js): a module of its own with the entry `<sub>/<sub>.ts`, imported directly by everyone, its parent included.
- *The entry defines the API* and holds the most important code. Internal files import its types, and its values only at runtime, never while modules load.
- *Subfolders* (`model/`, `visual-editor/`, `worker/`) have no entry; their files import each other directly.
- *`*.worker.ts` runs only in a Web Worker*; files without the suffix run on the main thread or in both.
- *No re-exports*, except `src/index.ts` and a host contract's re-export of its implementation and helpers. An outside caller needing an internal name means the code belongs in the entry, or is a module of its own.
- *Folders are named after a concept*: no `utils/`, `impl/`, `helpers/`, `shared/`, `services/`.
- *About 3 source files at a module's top level* (entry, `-impl.ts`, one more; tests and `.css` don't count); more get subfolders by concept.
- *No cycles between modules*.
- *Module scope holds constants and pure functions only.* State lives in an instance with a widget's lifetime: made in a host's constructor or an extension's `activate`, released by `dispose` or `subscriptions`. Two exceptions: a `WeakMap` memo on values that never change, and a singleton for what exists once per page (a wasm instance), named as such.

== Layers <architecture-conventions-layers>

- *Imports go down only* (`eslint.config.js`, `layers`; the picture: @architecture-overview-layers): `editor/` and `editor-element/` → `extensions/<name>/` → its `model/` → `core/`, and `hosts/` → `core/`.
- *`core/` has no DOM*: no library that needs it (Tiptap, prosemirror-view, CodeMirror views), no Yjs. `model/` likewise uses no editor library.
- *An extension never imports another one*; `testing/` is imported by `*.test.ts` only.
- *The line between model and view is the DOM.* Pure display logic (zoom presets, tree rows) is model.
- *Window = everything visible; extension host = the extensions' lifecycle; `editor/` = the composition*: `hosts/window` holds what is shown and interacted with, `hosts/extension-host` activates extensions, processes their `contributes` and holds the workspace, `editor/` makes and wires the hosts (`editor/widget/`, which also registers the Visual and Source editors as the window's custom editors). No host composes the others.
- *Hosts keep only mechanism.* For every host member ask: mechanism, or one feature's policy? Policy is an extension.
- *A host's entry `<name>.ts` is its contract*: the interfaces and types others see, first; at the bottom the re-exports of the implementation others construct and of its helpers.
- *`<name>-impl.ts` is the implementation*, starting with `See <Contract> in <name>.ts`.
- *`<name>-helpers.ts` holds stateless DOM-bound helpers*, each tagged `@helper Stateless: no registry, no per-widget state.`. A helper only one extension uses lives in that extension.
- *Extensions never depend on each other*: not through imports, services, commands or schema names. A host offers a generic contribution point; the consumer reads every contribution. Another extension's schema names are read only as data and always guarded (`schema.nodes.x`, `editor.can()`).

== Extension API <architecture-conventions-api>

- *VS Code's names and shapes* where a concept matches: `activate`, `subscriptions`, `register…Provider`, `provide…` / `resolve…`, `onDid<Verb>`, `executeCommand`, `getConfiguration`, `showInputBox`, `showQuickPick`, `show…Message`.
- *Extensions are factories* (`markup()`, `collaboration(options)`), so options can come later.
- *Contributions register once, at activation*, apply to every editor made later and return a `Disposable` for `context.subscriptions`.
- *One disposal verb*: `dispose()`. Only what a library calls keeps its name (`destroy` in node views and view plugins).
- *Competing contributions* have an explicit tie-breaker (@architecture-extensions-rules); registration order counts only within one extension.
- *Commands*: `executeCommand` returns a `Promise<T>`, but the handler runs synchronously, so user activation, selection and focus stay intact.
- *Settings* work as VS Code's (@architecture-extensions-settings). `createEditor` takes content and host wiring only and reports through `onDid…` events on its handle.
- *CSS*: each host and extension brings its own `<name>.css` (an extension registers it with `registerStyleSheet`); `editor.css` keeps only the `--zwf-*` tokens and the frame. Order: tokens and frame, hosts, extensions.
- *Class names*: an extension's own (`zwf-<extension>`, `__…`, `--…`), colors from the `--zwf-*` tokens. It never styles a host's classes; `data-scheme` is the one shared hook.
- *Talking to the user* goes through `window` (`show…Message`, `showInputBox`, `showQuickPick`, `showSaveDialog`, `showContextMenu`), never hand-made popovers or menus.
- *State an extension keeps* goes into `globalState` (per viewer) or `workspaceState` (per project), never straight into `localStorage`.

== Naming and types <architecture-conventions-naming>

- *Names say what something does*: a function that computes a change without applying it says so (`calculateImportChange`, not `addImport`).
- *CQRS-like vocabulary*: commands (`FileChange`, `TextChange`) go out, `onDid…` events come back, indexes (`LabelIndex`, `TypstStyleIndex`) are read models, `calculate…` is the pure decide step.
- *Value types instead of bare strings and numbers*: branded types with a same-named companion object (`ProjectPath.parse`, `SourceOffset.of`), parsed at the edges (public API, Yjs, storage, engine results), typed inside. A framework's own numbers stay as they are (ProseMirror positions); conversions live in one place (`sourceToPos` / `posToSource`, `pointOnPage`).
- *Discriminated unions use `kind`*; wire messages (room and worker protocol) use `type`.
- *No "main file vs. the rest" special cases* in the API.
- *Notifications instead of manual repair*: a model tells its listeners every change; nobody calls `refresh()`.

== Comments and tests <architecture-conventions-comments>

- *One why comment per concept*: the doc comment of the main element of a module's entry. A file inside a module gets one only when it is a concept of its own (a value type, the worker, a deep class).
- *A why comment says what it is*: the first line names it; then only who uses it (a list when there are several) and what it guarantees, concretely. No rules of the wider system, no neighbours, no `See docs/…`. Usually under 10 lines, true for the code as it is. Example: `src/hosts/commands/commands.ts`.
- *Every other file points to its why*: a top line `See <path>` or `See <Name> in <path>`; a test starts with `Tests for X`. `quality:top-comments` checks the pointers.
- *A host's own widgets are `@internal`*, with the API through which extensions get them.
- *API doc comments* say what a parameter, result or member means; never restate the code.
- *No history, no backwards compatibility*: no "was …", "renamed from", no shims. Code and docs describe only what is.
- *Tests go through the exported interface* of the unit under test. Model tests run without jsdom.
- *A host's tests* use the host's own minimum plus specs defined in the test; tests that need the whole widget live in `editor/` or use `testing/`.

== Process <architecture-conventions-process>

- Commit per step, all checks green; docs change in the same commit as the code.
- Open work is listed in @architecture-development-open-work. Research and plans live in `docs/YYYY_MM_DD_slug.md` until distilled into these chapters.
