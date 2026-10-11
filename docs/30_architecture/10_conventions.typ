= Conventions <architecture-conventions>

How code is written here. `mise run quality` enforces what it can (@architecture-development); the rest is for authors and reviewers.

== Design <architecture-conventions-design>

- *Overall complexity as low as possible*, measured in obviousness, not lines. Every type, helper, wrapper or contribution point of ours is a concept someone must learn. Prefer the frameworks' concepts and plain code. Size helpers by what is used today.
- *A new concept of ours only where two areas meet*: Typst ↔ ProseMirror (`hosts/prosemirror-typst`), Typst ↔ CodeMirror (raw boxes), our extension API ↔ a framework. Inside one area, use its own concepts and plain functions.
- *Every new concept is proposed to the user first*, with what it replaces and what it brings. Renames, moves and plain functions are not new concepts.
- *Deep modules*: a lot hidden behind a small interface. Don't split a deep class into shallow ones (`Project` stays one class).
- *Information hiding*: expose what callers need. No member exists only for tests or for one caller's convenience.
- *No pass-through layers*: a host does not take data from one extension only to hand it back to it.
- *Files read general to specific*: the file's main element (the class, function or spec it is named after, usually its first export) comes first, then the other exports, then private helpers in the order they are used (function declarations are hoisted). A constant or class needed while the module loads (spread into an export, passed to `Extension.create(…)`) sits directly above its user, as small as possible; ESLint's `no-use-before-define` checks that.
- *The _why_ is the main element's doc comment*, so it is read above the fold together with the code it explains. The file's top keeps at most one short line of context and its `See …` pointer.
- *Remove what does not work* rather than polish it.
- *Editing stays inline*: popovers, tags and bars at the content (image tools, label tags, the Align menu, the table bar). No inspector panel.

== Modules and folders <architecture-conventions-modules>

- A module is `core/<name>/`, `hosts/<name>/`, `extensions/<name>/`, `typst-editor/`, `typst-editor-element/` or `testing/`. From outside, only its *entry file* may be imported. The entry lives inside its folder.
- *The entry defines the API*; the most important code lives there. Internal files import the entry's types; they may use its values at runtime, never while modules load.
- Subfolders (`model/`, `visual-editor/`, `worker/`) are layer or concept folders without entries; files import each other directly.
- *No re-exports* (`export … from`, forwarding an imported name), except `src/index.ts`, the package entry. An outside caller needing an internal name means the code belongs in the entry, or the concept is a module of its own (`core/typst-syntax`, `hosts/prosemirror-typst`). Split a concept out when its types and class form an API of their own, so entries don't grow into type collections.
- Folders are named after a concept, never `utils/`, `impl/`, `helpers/`.
- *No cycles between modules*.

== Layers <architecture-conventions-layers>

#table(
  columns: (auto, 1fr, 1fr),
  table.header[Layer][May use][Must not use],
  [`core/`], [other `core/` modules], [the DOM, editor libraries, Yjs, anything outside `core/`],
  [`hosts/`], [the DOM, editor libraries, `core/`], [extensions, `typst-editor/`, `testing/`],
  [`extensions/<name>/`], [hosts' entries, `core/`], [other extensions],
  [`extensions/<name>/model/`], [`core/`], [the DOM, editor libraries, hosts, the extension's view folders],
  [`typst-editor/`, `typst-editor-element/`], [every module's entry], [—],
  [`testing/`], [every module's entry], [being imported by non-test code],
)

- *The line between model and view is the DOM.* Pure display logic (card layout, zoom presets, tree rows) is model.
- *Hosts keep only mechanism.* For every host member ask: mechanism, or one feature's policy? Policy is an extension. A host folder may also be a host's model module without contribution points (`hosts/prosemirror-typst`).
- *Extensions never depend on each other*: not through imports, a service registry, commands or schema names. When one has something for another, a host offers a generic contribution point and the consumer reads every contribution. Another extension's schema names are read only as data (node groups like `figureBody`, configured type lists) and always guarded (`schema.nodes.x`, `editor.can()`).

== Extension API <architecture-conventions-api>

- *VS Code's names and shapes* where a concept matches: `activate`, `subscriptions`, `register…Provider`, `provide…` / `resolve…`, `onDid<Verb>`, `executeCommand`, `getConfiguration`, `showInputBox`, `showQuickPick`, `show…Message`. Rename ours to them; never "ours, in VS Code terms" comments.
- *Extensions are factories* (`markup()`, `collaboration(options)`), so options can come later without a break.
- *Contributions register once, at activation*; hosts apply them to every editor made later. Each returns a `Disposable` pushed to `context.subscriptions`.
- *One disposal verb*: `dispose()` for everything with a lifetime (hosts, editors, `Project`, the widget). Only what a library calls keeps its name (ProseMirror node views, CodeMirror view plugins: `destroy`).
- *Competing contributions* have an explicit tie-breaker. Registration order counts only within one extension, never between extensions.

#table(
  columns: (auto, 1fr),
  table.header[Contribution][Tie-breaker],
  [nodes, marks (schema order, mark nesting, keymaps, which spec claims a syntax)], [the Tiptap extension's own `priority` (default 100, higher first); no `priority` of ours],
  [box renderers, link providers, PDF options, custom editors], [our `priority` (default 100, higher first)],
  [toolbar and menu items], [`group` + `order`],
  [status bar items], [`alignment` + `priority`],
  [Source editor extensions], [CodeMirror's `Prec`],
)

- *Name the framework* a member takes or returns: `registerTiptapExtension`, `registerCodeMirrorExtension`, `registerRawBoxCodeMirrorExtension`. Framework types are used directly, never aliased (Tiptap's `Node`, CodeMirror's `Extension`, Lezer's `SyntaxNode`).
- *Events*: `readonly onDid<Verb>: Event<T>`; subscribing returns a `Disposable`. Never `onChange(listener) → unsubscribe`. An event about one object takes it as an argument (`onDidChangeGrammar(schema, listener)`). Option callbacks passed in (`onFilesChange`) are fine.
- *Commands*: string ids `<extension>.<verb>`; `executeCommand<T>(id, ...args): Promise<T>`; the handler runs synchronously, so user activation, selection and focus stay intact. A shortcut on the widget handle exists only when documented (`exportPdf`).
- *Settings*: declared in `contributes.configuration` (`<extension>.<key>`, type, default, description), read with `getConfiguration`, followed with `onDidChangeConfiguration`. `createTypstEditor` takes content and host wiring only, no per-feature options.
- *CSS*: every host brings its own `<name>.css`, which the workbench adds (`styleSheet`). `typst-editor.css` keeps only the `--te-*` tokens and the frame. An extension brings `<name>.css` and registers it (`registerStyleSheet`), with class names of its own (`typst-<extension>`, `typst-<extension>__…`, `typst-<extension>--…`; on a host's element too, e.g. through Tiptap's `HTMLAttributes` or a renderer's `className`) and colors from the `--te-*` tokens. It never styles a host's classes; the widget's `data-scheme` is the one shared hook. Order: tokens and frame, hosts, extensions.
- *Talking to the user* goes through `window` (`show…Message`, `showInputBox`, `showQuickPick`, `showSaveDialog`, `showContextMenu` for a contributed menu), never hand-made popovers or menus.
- *What an extension keeps* goes into `globalState` (per viewer) or `workspaceState` (per project, per session), never straight into `localStorage`.

== Naming and types <architecture-conventions-naming>

- *Names say what something does.* A function that computes a change without applying it says so: `calculateImportChange`, not `addImport`.
- *CQRS-like vocabulary*: commands (`FileChange`, `TextChange`) go out, `onDid…` events come back, indexes (`LabelIndex`, `TypstStyleIndex`) are read models, a `calculate…` function is the pure decide step.
- *Value types instead of bare strings and numbers*: branded types (`string & { __type: 'X' }`, `number & { __type: 'X' }`) with a same-named companion object (`ProjectPath.parse` / `resolve`, `SourceOffset.of`): `ProjectPath`, `PathReference`, `SourceOffset` / `SourceRange`, `PageIndex`, `Pt`, `Px`. Parse at the edges (public API, Yjs, awareness, drag data, storage, engine results); typed inside. Plain DTOs crossing to the host or the engine may stay string-keyed. A framework's own numbers stay as they are (ProseMirror positions); conversions between units live in one place (`sourceToPos` / `posToSource`, `pointOnPage`).
- *Discriminated unions use `kind`*: `{ kind, … }`. Wire messages (room protocol, worker protocol) use `type`.
- *No "main file vs. the rest" special cases* in the API.
- *Notifications instead of manual repair*: a model tells its listeners every change; nobody needs `refresh()`.

== Comments and tests <architecture-conventions-comments>

- Every source file names its context: a top comment (one short line and where to read more: `See <entry file>`, `See docs/30_architecture/07_workbench.typ`; `Tests for X`), or the doc comment of its main element. `quality:top-comments` checks that a file has one of them and that every `docs/…` file named exists.
- Comments say _why_, or what a name cannot. No history ("was …", "moved from …"), no restating the code.
- *No migration notes, no backwards compatibility*: no "renamed from", no shims. Code and docs describe only what is.
- Tests go through the exported interface of the unit under test (an entry, or a file inside the module). Model tests run without jsdom.
- A host's tests use the host's own minimum plus specs defined in the test. Tests needing the whole widget live in `typst-editor/` or use `testing/`, never another extension.

== Process <architecture-conventions-process>

- Every operation is a mise task (@architecture-development). Tools pinned to exact versions.
- Commit per step, all checks green before each commit. Docs change in the same commit as the code.
- Open work is listed in @architecture-development-open-work. Research and plans live in `docs/YYYY_MM_DD_slug.md` until distilled into these chapters, then go.
