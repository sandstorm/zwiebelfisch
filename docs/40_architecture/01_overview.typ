#import "../template.typ": mermaid, unreviewed

= Architecture overview <architecture-overview>

Zwiebelfisch is a Typst editor that runs in the browser: no server needed to edit, compile or export. A server joins only for collaboration.

== Building blocks <architecture-overview-stack>

#figure(
  mermaid(read("../diagrams/overview-stack.mmd"), width: 80%),
  caption: [Main components],
)

#table(
  columns: (auto, 1fr),
  table.header[Component Name][Explanation],
  [Core model], [`src/core/`: the `Project` and one `TypstDocument` per `.typ` file, the single source of truth. Every view reads it and edits it with `TextChange`s (@architecture-data-model).],
  [Typst compiler], [The official Rust code from`crates/typst-engine` is compiled to wasm. Runs in a Web Worker owned by the preview component. Compiles the project to SVG pages, HTML or PDF. Fonts and Typst packages (`@preview` ) load on demand.],
  [Typst parser], [The Lezer grammar of `codemirror-lang-typst` is used for building the Visual editor document, highlights code, and feeds the indexes (labels, styles, imports). This runs on the browser's thread (and not in a web worker) on every keystroke],
  [#link("https://tiptap.dev/")[Tiptap] / #link("https://prosemirror.net/")[ProseMirror]], [Basis for the Visual WYSIWYG editor.],
  [#link("https://codemirror.net/")[CodeMirror] 6], [Used in the Source editor, the code of raw boxes (in the visual editor), and other text files' editor.],
  [#link("https://yjs.dev/")[Yjs]], [Collaboration module (@architecture-data-model-collaboration).],
  [Go server (optional)], [`server/`: relays and stores collaboration rooms over the #link("https://tiptap.dev/docs/hocuspocus")[Hocuspocus] protocol, signs people in by OpenID Connect, backs a room with a GitLab branch.],
)

- *Two parsers:* the compiler's own parser stays in the worker; everything on the main thread reads Typst through Lezer.
- *Only changes cross the worker boundary:* the preview sends a file once, then only when it changed; the worker sends back only pages whose SVG changed.

== Code structure <architecture-overview-layers>

#figure(
  mermaid(read("../diagrams/overview-layers.mmd"), width: 95%),
  caption: [The folders of `src/`; an arrow means "imports".],
)

- *`core/`*: models without DOM like `TypstDocument`, `Project`.
- *`hosts/`*: the main view components, and extension APIs: `visual-editor/`, `source-editor/`, `preview/`, `window/`, plus the namespaces `commands/`, `languages/`, `scm/` and `extension-host/` (with `workspace/`).
- *`extensions/`*: one per feature, we try to push as much as possible into extensions. *Extensions cannot depend on other extensions*.
- *`editor/`*: `createEditor` and the `Widget`, which makes and wires the hosts; *`editor-element/`*: the `<zwiebelfisch-editor>` custom element.
- *`testing/`*: helpers for `*.test.ts` only.

== Borrowed from VS Code <architecture-overview-vscode>

The code is organized in a way inspired by VS Code. A *workbench* offers the main UI elements and extension APIs, and extensions implement features.

- *We try to keep hosts as small as possible, and move as much logic as possible into extensions.*
- *Extensions never import each other;* they meet at the hosts' contribution points (@architecture-extensions-points), e.g. by calling a command from another extension.
