#import "../template.typ": mermaid, unreviewed

= Core <architecture-core>

#unreviewed

The models everything builds on, in `src/core/`: text, files, paths, the Typst engine, Typst syntax. Tests run in Node. No DOM, editor library or Yjs (@architecture-conventions-layers); `fetch`, `Blob` and streams are fine, workers have them.

== TypstDocument <architecture-core-document>

*The one text of a `.typ` file*, shared by every view of it; views never talk to each other, so a new one only has to speak changes.

- *One edit format:* every view (Visual editor, Source editor, the collaboration's `Y.Text`) calls `change(TextChange[], origin)` and listens to `onDidChange`; the `origin` lets a view skip its own echo.
- *No collaboration in core:* the collaboration extension binds a `Y.Text` from outside (@configuration-collaboration-server).
- *Offsets are made at the edges* (`SourceOffset.of`, `SourceRange.of`); ProseMirror positions only through the position map (@architecture-typst-conversion-position-map).
- *`syntaxTree`* is parsed once per text and kept on the document.

== Project <architecture-core-project>

*The files of one widget*: `.typ` files as `TypstDocument`s, every other file as bytes, and the main file. The single place a file is created, renamed or deleted.

#figure(
  mermaid(read("../diagrams/core-project-change.mmd"), width: 32%),
  caption: [A file change; `apply` throws where `check` refuses.],
)

- *Documents outlive renames:* `rename` and `replace` keep the `TypstDocument`s of paths that stay, so open editors survive.

== Paths <architecture-core-paths>

*`ProjectPath` is a checked absolute path* (`/chapters/intro.typ`), `PathReference` one as written in Typst (relative or from the root). Strings are parsed once, at the edges (public API, Yjs keys, drag data, storage, engine paths); inside, every path is typed.

== The Typst engine <architecture-core-engine>

*Typst itself*, Rust (`crates/typst-engine`) compiled to wasm. It knows nothing of documents or editors.

- *Where it runs:* one wasm instance per worker; the preview owns the worker and sends it the files (@architecture-preview).
- *Loaded on demand:* a font face's data when the layout first uses it (sync XHR), an `@preview/…` package when an import misses it.
- *Memory:* after every `compile`, `compileHtml` and `exportPdf` the engine evicts the memoized results the last 10 did not use, as `typst watch` does; the devtools show `memoryInUse`.
- *Crashes* are logged; the preview then starts a new worker (@architecture-preview-rules).

=== Fonts <architecture-core-engine-fonts>

Typst needs every face's `FontInfo` before a compile, a face's data only when the layout uses it: 5 files instead of 17 on the first render of the simple example (2.7 MB instead of 9.7 MB). `mise run build:fonts` writes the index with the engine's own wasm.

=== Engine size <architecture-core-engine-size>

`typst_engine_bg.wasm` is 23 MB raw, 6.6 MB brotli. Typst has no feature flags to cut it. Not done: a fork; `opt-level = "z"` (−0.4 MB brotli).

- *Delivery:* `dist/lib` names the wasm and the fonts with a content hash, so a host can cache them as `immutable`; compression and `Content-Type: application/wasm` are the host's job.

== Typst syntax <architecture-core-syntax>

*Reading Typst without compiling it*, fast enough for every keystroke: pure functions over the Lezer tree of `codemirror-lang-typst` (file paths, imports, neighbours, calls), shared by the extensions and the conversion's specs.

*Also in core:* `Disposable`, `EventEmitter`, `CancellationToken` (VS Code's), `User`, `uploads` (files from the computer as `create` changes), `color-scheme`.

== How extensions hook in <architecture-core-extensions>

Extensions read the `project` and its `TypstDocument`s, and change files only through `workspace.applyEdit`, which the project's rules and then the host page may refuse.

```ts
// simplified from src/extensions/document-links/document-links.ts
commands.registerCommand('documentLinks.createFile', async (path: string) => {
  const target = ProjectPath.parse(path);
  if (!target) throw new Error(`Not a project path: ${path}`);
  const problem = await workspace.applyEdit({ kind: 'create', path: target, content: '' });
  if (problem !== null) throw new Error(problem);
  window.showDocument(target);
});
```

- *Never `project.apply`:* it skips the host's veto.
- *Text edits of an open `.typ` file* go to its `TypstDocument` (`change`), with the extension's own `origin`.
