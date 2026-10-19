#import "/template.typ": unreviewed

= Core <architecture-core>

#unreviewed

The models everything builds on, in `src/core/`; tests run in Node. No DOM, editor library or Yjs (@architecture-conventions-layers), but `fetch`, `Blob` and streams are fine: workers have them.

== TypstDocument <architecture-core-document>

The text of one `.typ` file: the single source of truth.

```ts
new TypstDocument(text)
.text
.change(changes: TextChange[], origin)  // all in coordinates of the text before the call
.setText(text, origin)                  // applied as one minimal change
.onDidChange: Event<{ contentChanges, origin }>
```

- *Source offsets:* `SourceOffset` (branded number, UTF-16 code units) and `SourceRange` (`{ from, to }`); a `TextChange` is a `SourceRange` plus `insert`. Make them with `SourceOffset.of(n)` / `SourceRange.of({ from, to })` where offsets come in.
- *Never a ProseMirror position:* only `sourceToPos` / `posToSource` convert (@architecture-prosemirror-typst-position-map).
- *Echo suppression:* an editor passes itself as `origin` and ignores events with its own origin.
- *Ordered delivery:* a change made by a listener is queued, so every listener sees changes in the order they were made.
- `minimalChange(before, after)`: the one change between common prefix and suffix, so cursors and undo survive a whole new text.
- *No collaboration here:* the collaboration extension binds a `Y.Text` from outside (@configuration-collaboration-server).

== Project <architecture-core-project>

Which files a project has and which changes are allowed.

```ts
type FileChange =
  | { kind: 'create'; path; content } | { kind: 'update'; path; content }
  | { kind: 'delete'; path }          | { kind: 'rename'; from; path }
```

- *Files by `ProjectPath`:* a `.typ` file is a `TypstDocument` (kept across renames, so open editors survive); any other file is a `FileContent` (`string | Uint8Array`).
- *The main file* (`main`) always exists and cannot be renamed or deleted. `setMain(path)` makes another `.typ` file the main one (a reason or null; refused when the host locked it, `mainLocked`), `onDidChangeMain` tells. `.typ` files keep their ending.
- `check(change)` returns a reason or null; `apply(change)` throws where `check` refuses.
- `replace(files)` reports a `delete`, `create` or `update` per file and keeps the documents of paths that stay.
- `onDidChangeFile` fires a `FileChange` for every change, document edits included (as `update`). Nobody refreshes by hand.

== Paths <architecture-core-paths>

Two branded strings: free at runtime, usable as keys, unchanged through `postMessage`, Yjs and the server.

- `ProjectPath`: where a file is (`/chapters/intro.typ`). Absolute, no `.`, `..` or empty segments.
- `PathReference`: a path as written in Typst (`img/logo.png`, `../x.typ`, `/data.csv`).

- `resolve(file, reference)` resolves as Typst does; `referenceTo(file, target)` writes the reverse. The other helpers: see the d.ts.
- *Parsed once, at the edges* (public API, Yjs keys, drag data, storage, engine paths). Inside, every path is typed.
- `isTypst(path)` is the only file kind core knows.

== The Typst engine <architecture-core-engine>

The Typst compiler, SVG, PDF and HTML export and hit-testing: Rust (`crates/typst-engine`) compiled to wasm. The preview runs it in a worker (@architecture-preview).

- `typst-engine`: `createEngine(wasm)` returns the engine; its members: see the d.ts.
- `engine-assets`: the wasm URL and `DEFAULT_FONTS` for the main thread, apart so the worker bundle does not copy them.
- `typst-packages`: `withPackages(engine, fetchPackage?, onDidChangeDownloads?)` compiles, downloads missing `@preview` packages, compiles again.
- *Units:* UTF-16 offsets (`SourceOffset`), 0-based pages (`PageIndex`), points from the page's top-left (`Pt`), project or package paths (`@preview/name:0.1.0/lib.typ`). A diagnostic's path is a `ProjectPath`, or `null` without location or in a package.
- *Memory:* after every `compile`, `compileHtml` and `exportPdf` the engine evicts the memoized results the last 10 did not use, as `typst watch` does. `memoryInUse` tells the wasm memory's bytes (it never shrinks; the most is `ENGINE_MEMORY_LIMIT`, 4 GiB); the devtools show it (@configuration-embedding-devtools).
- *Crashes:* a panic or running out of memory traps the wasm, and the instance is lost: every later call throws the first `TypstEngineCrash` (with the panic's message), also logged. The preview then starts a new worker (@architecture-preview-rules).

=== Fonts <architecture-core-engine-fonts>

Typst needs every face's `FontInfo` before a compile, but a face's data only when the layout uses it. So fonts load lazily: 5 files instead of 17 on the first render of the simple example (2.7 MB instead of 9.7 MB).

- *Font index:* `mise run build:fonts` copies the 17 default font files and writes `fonts.gen/index.json` (file name → `FontInfo[]`), computed by the engine's own wasm.
- `addLazyFont({ name, faces, load })`: the faces go into the font book; the first use of one calls `load()` synchronously, inside the compile. In the worker that is a synchronous `XMLHttpRequest`.
- *A file that cannot be loaded:* Typst falls back to another font and the compile reports a warning without location.
- *Project fonts:* a project file ending in `.ttf`, `.otf`, `.ttc` or `.otc` is a font too, as on typst.app. Whoever hands the engine the project's files hands it its fonts.

=== Engine size <architecture-core-engine-size>

`typst_engine_bg.wasm` is 23 MB raw, 6.6 MB brotli. Typst has no feature flags to cut it (bibliography, PDF export, plugins, images, hyphenation all stay); not done: a fork, `opt-level = "z"` (−0.4 MB brotli).

- *Delivery:* `dist/lib` names the wasm and the fonts with a content hash, so a host can cache them as `immutable`. Compression and `Content-Type: application/wasm` are the host's server's job.

== Typst syntax <architecture-core-syntax>

Typst knowledge several extensions need, read from the Lezer tree of `codemirror-lang-typst` (`syntaxTree` keeps the last one, so one text is parsed once):

- `findFilePaths`: the paths a text names.
- `neighbours`: the files' reading order; it parses only the files whose text changed.
- `calculateImportChange`, `importedNames`: the change that imports a name, and the names imports bind.
- Helpers specs read calls with (`calleeName`, …): see the d.ts.

*Also in core:* `Disposable`, `EventEmitter`, `CancellationToken` (VS Code's), `User`, `uploads` (files from the computer as `create` changes), `room-protocol` (the rooms' Y.Doc layout; the server mirrors it, @architecture-server), `color-scheme`.
