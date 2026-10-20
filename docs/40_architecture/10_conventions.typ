#import "/template.typ": unreviewed

= Conventions <architecture-conventions>

#unreviewed

How code is written here. `mise run quality` checks what it can (@architecture-development); reviewers check the rest.

== Design <architecture-conventions-design>

- *Keep overall complexity low*, measured in obviousness, not lines. Every type, helper or contribution point of ours is a concept someone must learn. Prefer the frameworks' concepts and plain code.
- *New concepts of ours only where two areas meet*: Typst ↔ ProseMirror (`hosts/visual-editor/typst-conversion`), Typst ↔ CodeMirror (raw boxes), our extension API ↔ a framework. Inside one area, use its own concepts.
- *Propose every new concept to the user first*, with what it replaces and what it brings. Renames, moves and plain functions are not new concepts.
- *Deep modules*: a lot hidden behind a small interface, as in _A Philosophy of Software Design_. Don't split a deep class into shallow ones (`Project` stays one class).
- *Information hiding*: expose what callers need. No member exists only for tests or one caller's convenience.
- *No pass-through layers*: a host does not take data from an extension only to hand it back.
- *Files read general to specific*: the main element (the export the file is named after) first, then the other exports, then private helpers in the order they are used. A constant needed while the module loads sits directly above its user (`no-use-before-define`).
- *Remove what does not work* rather than polish it.
- *Editing stays inline*: popovers, tags and bars at the content, as in Notion. No inspector panel.

== Modules and folders <architecture-conventions-modules>

- *A module* is `core/<name>/`, `hosts/<name>/`, `extensions/<name>/`, `editor/`, `editor-element/` or `testing/`. From outside, import only its *entry file*.
- *The entry defines the API* and holds the most important code. Internal files import its types; they use its values at runtime only, never while modules load.
- *Subfolders* (`model/`, `visual-editor/`, `worker/`) have no entry; their files import each other directly.
- *`*.worker.ts` runs only in a Web Worker*; files without the suffix run on the main thread or in both.
- *No re-exports*, except `src/index.ts`, a host contract's re-export of its implementation, and a host entry's re-export of a subfolder's contract (`visual-editor.ts` forwards `typst-conversion/`). When an outside caller needs an internal name, the code belongs in the entry, or it is a module of its own (`core/typst-syntax`).
- *Folders are named after a concept*, never `utils/`, `impl/`, `helpers/`.
- *No cycles between modules*.

== Layers <architecture-conventions-layers>

#table(
  columns: (auto, 1fr, 1fr),
  table.header[Layer][May use][Must not use],
  [`core/`], [other `core/` modules], [the DOM, editor libraries, Yjs, anything outside `core/`],
  [`hosts/`], [the DOM, editor libraries, `core/`], [extensions, `editor/`, `testing/`],
  [`extensions/<name>/`], [hosts' entries, `core/`], [other extensions],
  [`extensions/<name>/model/`], [`core/`], [the DOM, editor libraries, hosts, the extension's view folders],
  [`editor/`, `editor-element/`], [every module's entry], [—],
  [`testing/`], [every module's entry], [being imported by non-test code],
)

- *The line between model and view is the DOM.* Pure display logic (zoom presets, tree rows) is model.
- *Hosts keep only mechanism.* Ask for every host member: mechanism, or one feature's policy? Policy is an extension.
- *A host's entry `<name>.ts` is its contract*: the interfaces and types others see, contract first; its re-exports, at the bottom, are the implementation others construct and, one line per subfolder, a subfolder's contract the host's users need (the Visual editor's `typst-conversion/`).
- *`<name>-impl.ts` is the implementation*, starting with `See <Contract> in <name>.ts`.
- *Extensions never depend on each other*: not through imports, services, commands or schema names. A host offers a generic contribution point instead, and the consumer reads every contribution. Another extension's schema names are read only as data (`figureBody`) and always guarded (`schema.nodes.x`, `editor.can()`).

== Extension API <architecture-conventions-api>

- *Use VS Code's names and shapes* where a concept matches: `activate`, `subscriptions`, `register…Provider`, `provide…` / `resolve…`, `onDid<Verb>`, `executeCommand`, `getConfiguration`, `showInputBox`, `showQuickPick`, `show…Message`.
- *Extensions are factories* (`markup()`, `collaboration(options)`), so options can come later.
- *Contributions register once, at activation*, and apply to every editor made later. Each returns a `Disposable` for `context.subscriptions`.
- *One disposal verb*: `dispose()`. Only what a library calls keeps its name (`destroy` in node views and view plugins).
- *Competing contributions* have an explicit tie-breaker (@architecture-extensions-rules). Registration order counts only within one extension.
- *Commands*: `executeCommand` returns a `Promise<T>`, but the handler runs synchronously, so user activation, selection and focus stay intact.
- *Settings* work as VS Code's (@architecture-extensions-settings). `createEditor` takes content and host wiring only; what it reports are `onDid…` events on its handle.
- *CSS*: each host and extension brings its own `<name>.css` (an extension registers it with `registerStyleSheet`). `editor.css` keeps only the `--zwf-*` tokens and the frame. Order: tokens and frame, hosts, extensions.
- *Class names*: an extension uses class names of its own (`zwf-<extension>`, `zwf-<extension>__…`, `zwf-<extension>--…`) and colors from the `--zwf-*` tokens. It never styles a host's classes; `data-scheme` is the one shared hook.
- *Talking to the user* goes through `window` (`show…Message`, `showInputBox`, `showQuickPick`, `showSaveDialog`, `showContextMenu`), never hand-made popovers or menus.
- *State an extension keeps* goes into `globalState` (per viewer) or `workspaceState` (per project), never straight into `localStorage`.

== Naming and types <architecture-conventions-naming>

- *Names say what something does.* A function that computes a change without applying it says so: `calculateImportChange`, not `addImport`.
- *CQRS-like vocabulary*: commands (`FileChange`, `TextChange`) go out, `onDid…` events come back, indexes (`LabelIndex`, `TypstStyleIndex`) are read models, `calculate…` is the pure decide step.
- *Value types instead of bare strings and numbers*: branded types with a same-named companion object (`ProjectPath.parse`, `SourceOffset.of`). Examples: `ProjectPath`, `PathReference`, `SourceOffset` / `SourceRange`, `PageIndex`, `Pt`, `Px`.
  - Parse at the edges (public API, Yjs, storage, engine results); typed inside.
  - A framework's own numbers stay as they are (ProseMirror positions). Conversions live in one place (`sourceToPos` / `posToSource`, `pointOnPage`).
- *Discriminated unions use `kind`*. Wire messages (room and worker protocol) use `type`.
- *No "main file vs. the rest" special cases* in the API.
- *Notifications instead of manual repair*: a model tells its listeners every change; nobody calls `refresh()`.

== Comments and tests <architecture-conventions-comments>

- *One why comment per concept*: the doc comment of the main element of a module's entry. A file inside a module gets one only when it is a concept of its own (a value type, the worker, a deep class).
- *A why comment says what it is*: the first line names it; then only what a caller needs: who uses it (a list when there are several) and what it guarantees, stated concretely. No rules of the wider system, no neighbours, no what it leaves to others, no `See docs/…`. Usually under 10 lines, plain words, true for the code as it is now. Example: `src/hosts/commands/commands.ts`.
- *Every other file points to its why*: a top line `See <path>` or `See <Name> in <path>`. A test starts with `Tests for X`. `quality:top-comments` checks that the pointers exist.
- *A host's own widgets are `@internal`*, with the API through which extensions get them.
- *API doc comments* say what a parameter, result or member means. Never restate the code.
- *No history, no backwards compatibility*: no "was …", "renamed from", no shims. Code and docs describe only what is.
- *Tests go through the exported interface* of the unit under test. Model tests run without jsdom.
- *A host's tests* use the host's own minimum plus specs defined in the test. Tests that need the whole widget live in `editor/` or use `testing/`.

== Process <architecture-conventions-process>

- Commit per step, all checks green. Docs change in the same commit as the code.
- Open work is listed in @architecture-development-open-work. Research and plans live in `docs/YYYY_MM_DD_slug.md` until they are distilled into these chapters.
