= Core <architecture-core>

The models everything builds on. Rules for `src/core/`:

- No DOM globals or types (`fetch`, `Blob` and streams are allowed: workers have them).
- No editor library (`@tiptap/*`, `prosemirror-*`, `@codemirror/*`) and no Yjs.
- Imports only `core/`. Tests run in Node.

== TypstDocument <architecture-core-document>

The text of one `.typ` file: the single source of truth.

```ts
new TypstDocument(text)
.text
.change(changes: TextChange[], origin)  // all in coordinates of the text before the call
.setText(text, origin)                  // applied as one minimal change
.onDidChange: Event<{ contentChanges, origin }>
```

- *Source offsets:* `SourceOffset` (a branded number, UTF-16 code units into the text) and `SourceRange` (`{ from, to }` of them); `TextChange` is a `SourceRange` plus `insert`. Made with `SourceOffset.of(n)` / `SourceRange.of({ from, to })` where offsets come in (string indices, Lezer nodes, CodeMirror, Yjs, the engine). Never a ProseMirror position: only the projection's `sourceToPos` / `posToSource` convert (@architecture-projection-position-map).
- *Echo suppression:* a view passes itself as `origin` and ignores events with its own origin.
- *Ordered delivery:* a change made by a listener while others are being told is queued, so every listener sees changes in the order they were made.
- `minimalChange(before, after)`: the one change between common prefix and suffix, so cursors and undo history survive a whole new text.
- *No collaboration here:* the collaboration extension binds a `Y.Text` to a document from outside (@guide-collaboration).

== Project <architecture-core-project>

Which files a project has and which changes are allowed.

- Files by `ProjectPath`. Every `.typ` file is a `TypstDocument` (kept across renames, so open views survive); every other file is stored as given (`FileContent`: `string | Uint8Array`; `FileContent.bytes(content)` encodes text as UTF-8).
- The main file always exists; it cannot be renamed or deleted. `.typ` files keep their ending.
- `check(change)` returns a reason or null; `apply(change)` throws where `check` refuses.
- `replace(files)` reports a `delete`, `create` or `update` per file and keeps the documents of paths that stay.
- `onDidChangeFile` fires for every change: `apply`, `replace`, and every document edit (as `update`). Nobody is refreshed by hand.

```ts
type FileChange =
  | { kind: 'create'; path; content } | { kind: 'update'; path; content }
  | { kind: 'delete'; path }          | { kind: 'rename'; from; path }
```

== Paths <architecture-core-paths>

Two branded strings: free at runtime, usable as keys, unchanged through `postMessage`, Yjs and the server.

#table(
  columns: (auto, 1fr),
  table.header[Type][Meaning],
  [`ProjectPath`], [Where a file is: `/chapters/intro.typ`. Absolute, no `.`, `..` or empty segments.],
  [`PathReference`], [A path as written in Typst source: `img/logo.png`, `../x.typ`, `/data.csv`.],
)

- `resolve(file, reference)` resolves as Typst does; `referenceTo(file, target)` writes the reverse.
- Parsed once, at the edges (public API, Yjs keys, drag data, storage, engine paths). Inside, every path is typed.
- `isTypst(path)` is the only file kind core knows.
- `name(path)` is the last segment (`intro.typ`); `displayName(path)` the path without its leading slash, as shown to people.

== The Typst engine <architecture-core-engine>

The Typst compiler, SVG and PDF export and hit-testing: Rust (`crates/typst-engine`) compiled to wasm. The preview runs it in a worker (@architecture-preview).

- `typst-engine`: `createEngine(wasm)`; `addFont`, `addLazyFont`; `setSource`, `setBinary`, `remove`; `compile`, `exportPdf`; `jumpFromClick`, `jumpFromCursor`, `boxesForRanges`.
- `engine-assets`: the wasm URL and `DEFAULT_FONTS` (URL and faces per file) for the main thread, apart so the worker bundle does not copy them.
- `typst-packages`: `withPackages(engine)` compiles, downloads the missing `@preview` packages, compiles again.
- Conventions: UTF-16 offsets (`SourceOffset`), 0-based pages (`PageIndex`; people see `index + 1`), points from the page's top-left (`Pt`), project or package paths (`@preview/name:0.1.0/lib.typ`).
- A diagnostic's path is parsed where the wasm's report is read: a `ProjectPath`, or `null` without location or in a package file.

=== Fonts <architecture-core-engine-fonts>

Typst's font book needs every face's `FontInfo` (family, variant, coverage) before a compile; a face's data only when the layout uses it (`World::font(index)`).

- *Font index*: `mise run build:fonts` copies the 17 default font files and writes `fonts/index.json` (file name → `FontInfo[]`, 16 KB), computed by the engine's own wasm, so it matches the pinned Typst.
- `addLazyFont({ faces, load })`: the faces go into the book; the first `World::font` call for one of them calls `load()` and keeps the result (null: the faces stay absent, Typst falls back). Synchronous, inside the compile: no second compile, and only the faces used are fetched.
- `addFont(data)`: all faces of a file, data at once (a host's own fonts).
- The preview's worker loads a file with a synchronous `XMLHttpRequest` (allowed in workers only); a compile waits for it.

#table(
  columns: (auto, auto, auto),
  table.header[First render of the hello example][Font files][Font bytes (gzip)],
  [all fonts up front], [17], [9.7 MB (6.4 MB)],
  [lazy], [4 + the index], [2.4 MB (1.7 MB)],
)

== Typst syntax <architecture-core-syntax>

Typst knowledge several extensions need, from the Lezer tree of `codemirror-lang-typst`: the paths a text names (`findFilePaths`), the files' reading order (`neighbours`), the change that imports a name (`calculateImportChange`), and helpers specs read calls with (`calleeName`, `namedArgument`, …).

Also in core: `Disposable`, `EventEmitter`, `User`, `uploads` (files from the computer as `create` changes), `room-protocol` (the rooms' Y.Doc layout, shared with @architecture-server), `color-scheme`.
