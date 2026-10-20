#import "../template.typ": api, unreviewed

= Core <architecture-core>

#unreviewed

The models everything builds on, in `src/core/`: text, files, paths, the Typst engine, Typst syntax. Tests run in Node. No DOM, editor library or Yjs (@architecture-conventions-layers); `fetch`, `Blob` and streams are fine, workers have them.

== TypstDocument <architecture-core-document>

#api("/src/core/typst-document/typst-document.ts", "TypstDocument", only: ("onDidChange",))
#api("/src/core/typst-document/typst-document.ts", "TypstDocumentChangeEvent")
#api("/src/core/typst-document/typst-document.ts", "TextChange")
#api("/src/core/typst-document/typst-document.ts", "SourceOffset")

- *No collaboration here:* the collaboration extension binds a `Y.Text` from outside (@configuration-collaboration-server), so core and every editor work without it.
- *Offsets are made at the edges* (`SourceOffset.of`, `SourceRange.of`), where a Lezer node, a CodeMirror position or a string index comes in; ProseMirror positions only through the position map (@architecture-typst-conversion-position-map).

== Project <architecture-core-project>

#api("/src/core/project/project.ts", "Project", only: ("onDidChangeFile", "onDidChangeMain", "mainLocked"))
#api("/src/core/project/project.ts", "FileChange")
#api("/src/core/project/project.ts", "ProjectFiles")

- *Every file change passes `check`:* it returns a reason for people or null; `apply` throws where `check` refuses.
- *Documents outlive renames:* a `.typ` file keeps its `TypstDocument` across `rename`, and `replace` keeps those of paths that stay, so open editors survive.

== Paths <architecture-core-paths>

#api("/src/core/paths/paths.ts", "ProjectPath")
#api("/src/core/paths/paths.ts", "PathReference")

- *Parsed once, at the edges:* the public API, Yjs keys, drag data, storage, engine paths. Inside, every path is typed.

== The Typst engine <architecture-core-engine>

Rust (`crates/typst-engine`) compiled to wasm. The preview runs it in a worker and hands it the wasm URL and the default fonts (@architecture-preview).

#api("/src/core/typst-engine/typst-engine.ts", "TypstEngine", docs: "first-sentence")
#api("/src/core/typst-engine/typst-engine.ts", "TypstEngineCrash")

`withPackages(engine)` adds `@preview` packages:

#api("/src/core/typst-packages/typst-packages.ts", "PackageEngine")

- *Memory:* after every `compile`, `compileHtml` and `exportPdf` the engine evicts the memoized results the last 10 did not use, as `typst watch` does. The devtools show `memoryInUse` (@configuration-embedding-devtools).
- *Crashes* are logged; the preview then starts a new worker (@architecture-preview-rules).

=== Fonts <architecture-core-engine-fonts>

Typst needs every face's `FontInfo` before a compile, a face's data only when the layout uses it. So fonts load lazily: 5 files instead of 17 on the first render of the simple example (2.7 MB instead of 9.7 MB).

#api("/src/core/typst-engine/typst-engine.ts", "LazyFont")

- *Font index:* `mise run build:fonts` copies the 17 default font files and writes `fonts.gen/index.json` (file name → `FontInfo[]`), computed by the engine's own wasm.
- *In the worker* `load()` is a synchronous `XMLHttpRequest`, since it runs inside the compile.

=== Engine size <architecture-core-engine-size>

`typst_engine_bg.wasm` is 23 MB raw, 6.6 MB brotli. Typst has no feature flags to cut it (bibliography, PDF export, plugins, images, hyphenation all stay). Not done: a fork; `opt-level = "z"` (−0.4 MB brotli).

- *Delivery:* `dist/lib` names the wasm and the fonts with a content hash, so a host can cache them as `immutable`. Compression and `Content-Type: application/wasm` are the host's server's job.

== Typst syntax <architecture-core-syntax>

The Typst knowledge several extensions and the conversion's specs need, in `typst-syntax.ts`: functions over the Lezer tree of `codemirror-lang-typst` (`findFilePaths`, `neighbours`, `calculateImportChange`, `importedNames`, helpers to read calls). `syntaxTree` keeps the last tree, so one text is parsed once.

*Also in core:* `Disposable`, `EventEmitter`, `CancellationToken` (VS Code's), `User`, `uploads` (files from the computer as `create` changes), `color-scheme`.
