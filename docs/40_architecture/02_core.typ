#import "../template.typ": unreviewed

= Core <architecture-core>

#unreviewed

The models everything builds on, in `src/core/`: text, files, paths, the Typst engine, Typst syntax. Tests run in Node. No DOM, editor library or Yjs (@architecture-conventions-layers); `fetch`, `Blob` and streams are fine, workers have them.

== TypstDocument <architecture-core-document>

*The one text of a `.typ` file*, shared by every view of it. The Visual editor, the Source editor and collaboration never talk to each other: each applies its edits to the document as `TextChange`s and follows its `onDidChange`. So any number of views stay in step, and a new one (a second editor, a remote user) only has to speak changes.

- *No collaboration here:* the collaboration extension binds a `Y.Text` from outside (@configuration-collaboration-server), so core and every editor work without it.
- *Offsets are made at the edges* (`SourceOffset.of`, `SourceRange.of`), where a Lezer node, a CodeMirror position or a string index comes in; ProseMirror positions only through the position map (@architecture-typst-conversion-position-map).
- *Its syntax tree* is computed once per text and kept on the document, for everyone who reads it.

== Project <architecture-core-project>

*The files of one widget*: the `.typ` files as `TypstDocument`s, every other file as bytes, and the main file. It is the single place a file is created, renamed or deleted; everything else follows its `onDidChangeFile`.

- *Every file change passes `check`:* it returns a reason for people or null; `apply` throws where `check` refuses.
- *Documents outlive renames:* a `.typ` file keeps its `TypstDocument` across `rename`, and `replace` keeps those of paths that stay, so open editors survive.

== Paths <architecture-core-paths>

*`ProjectPath` is a checked absolute path* (`/chapters/intro.typ`), `PathReference` one as written in Typst (relative or from the root). Strings are parsed once, at the edges: the public API, Yjs keys, drag data, storage, engine paths. Inside, every path is typed, so no module normalizes paths again.

== The Typst engine <architecture-core-engine>

*Typst itself*, Rust (`crates/typst-engine`) compiled to wasm: give it files, compile to pages, HTML or PDF, and ask where a click lands in the source. It knows nothing of documents or editors; the preview runs it in a worker and hands it the wasm URL and the default fonts (@architecture-preview). `withPackages(engine)` adds `@preview` packages, downloaded on first use.

- *Memory:* after every `compile`, `compileHtml` and `exportPdf` the engine evicts the memoized results the last 10 did not use, as `typst watch` does. The devtools show `memoryInUse` (@configuration-embedding-devtools).
- *Crashes* are logged; the preview then starts a new worker (@architecture-preview-rules). The wasm instance exists once per page (or worker) and is shared by its engines.

=== Fonts <architecture-core-engine-fonts>

Typst needs every face's `FontInfo` before a compile, a face's data only when the layout uses it. So fonts load lazily: 5 files instead of 17 on the first render of the simple example (2.7 MB instead of 9.7 MB).

- *Font index:* `mise run build:fonts` copies the 17 default font files and writes `fonts.gen/index.json` (file name → `FontInfo[]`), computed by the engine's own wasm.
- *In the worker* `load()` is a synchronous `XMLHttpRequest`, since it runs inside the compile.

=== Engine size <architecture-core-engine-size>

`typst_engine_bg.wasm` is 23 MB raw, 6.6 MB brotli. Typst has no feature flags to cut it (bibliography, PDF export, plugins, images, hyphenation all stay). Not done: a fork; `opt-level = "z"` (−0.4 MB brotli).

- *Delivery:* `dist/lib` names the wasm and the fonts with a content hash, so a host can cache them as `immutable`. Compression and `Content-Type: application/wasm` are the host's server's job.

== Typst syntax <architecture-core-syntax>

*Reading Typst without compiling it*, fast enough for every keystroke: pure functions over the Lezer tree of `codemirror-lang-typst` (`findFilePaths`, `neighbours`, `calculateImportChange`, `importedNames`, helpers to read calls). What several extensions and the conversion's specs need lives here once.

*Also in core:* `Disposable`, `EventEmitter`, `CancellationToken` (VS Code's), `User`, `uploads` (files from the computer as `create` changes), `color-scheme`.
