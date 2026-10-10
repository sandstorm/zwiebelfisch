# Architecture

This is the technical companion to the product concept in
[docs/2026_10_10_concept.md](docs/2026_10_10_concept.md). It describes the code as it is. When the
code changes, update this file in the same commit.

## Repository layout

```
crates/typst-engine/        Rust → wasm: Typst compiler, SVG export, click/cursor jumps
  src/world.rs              in-memory Typst World (files and fonts pushed from JS)
  src/lib.rs                wasm-bindgen interface (JSON in/out, UTF-16 offsets)
src/
  engine/                   typed TS wrapper around the wasm, default fonts (generated wasm/, fonts/ — gitignored),
                            withPackages (package download, tar reader), fixtures/ (test package archives)
  document/                 TypstDocument — the single source of truth (string or shared Y.Text); Highlight (a styled source range views draw)
  collab/                   real-time collaboration (loaded on demand): Collaboration, SharedProject, SharedComments,
                            RemoteCursors; in-process.ts (Y.Doc/awareness wiring for tests)
  comments/                 Comments (anchors + persistence), CommentsPanel (side panel), CommentsUI (wiring)
  diff/                     diffTexts — the text diff against a base version behind "Show changes"
  source-view/              SourceView — CodeMirror 6 editing view
  preview/                  Preview — worker-backed live preview + hit-testing, zoom, page numbers
    engine.worker.ts        hosts the engine off the main thread
    protocol.ts             request/response messages main ↔ worker
    project-files.ts        FileSender/FileReceiver: file maps across the worker boundary
    page-list.ts            page placeholders; SVG only for pages near the viewport
    latest-only.ts          "only the newest value" task runner (compiles, cursor reveals)
    geometry.ts, zoom.ts    pure helpers: overlay boxes, visibility, current page, zoom steps
    toolbar.ts              zoom buttons, zoom label, "page n / total"
    markers.ts              PreviewMarkers: margin marker layers placed via cursor lookups
  visual-view/              VisualView — Tiptap editor over the source-anchored projection,
                            formatting toolbar, raw boxes edited in a nested CodeMirror
  editor/                   createTypstEditor() — composes the widget, Visual/Source tabs, status bar, scoped CSS,
                            ChangeTracking (base version + "Show changes" toggle), CollaborationLink
    project.ts              Project: the file model (one TypstDocument per .typ file, main protected)
    editing-views.ts        Visual/Source tabs, lazily one VisualView + SourceView per document
    file-switcher.ts        file bar: tabs, new/upload/rename/delete, drop (optional mode)
    asset-view.ts           read-only image/data view with "Insert into …"
    paths.ts, insert-image.ts, upload.ts   pure helpers (names → paths, #image insertion, uploads)
  element/                  <typst-editor> custom element (shadow DOM) around createTypstEditor
  index.ts                  public API of the package; registers <typst-editor>
demo/                       dev/demo page (vite root); ?room=<name> joins ws://127.0.0.1:1234
server/                     collaboration server (Node package, Hocuspocus; TypeScript run by Node directly)
examples/plain-html/        <typst-editor> loaded from dist/lib without a bundler
tests/e2e/                  Playwright specs (run against the static build)
mise-tasks/                 every script (build, test, quality, …) — `mise tasks ls`
docs/                       research and concepts (YYYY_MM_DD_slug.md)
```

## Runtime picture

```
 main thread                                                    worker thread
┌──────────────────────────────────────────────────────────┐   ┌────────────────────────┐
│ createTypstEditor(host, { source })                      │   │ engine.worker.ts       │
│                                                          │   │                        │
│  ┌──────────────┐ change(edits, origin) ┌──────────────┐ │   │  ┌──────────────────┐  │
│  │  SourceView  │──────────────────────►│TypstDocument │ │   │  │  Engine (wasm)   │  │
│  │ (CodeMirror) │◄──────────────────────│  text        │ │   │  │  MemoryWorld     │  │
│  └──────┬───────┘   onChange(edits,     └──────┬───────┘ │   │  │  last document   │  │
│         │ ▲          origin ≠ self)            │         │   │  │  svg cache       │  │
│ onCursor│ │reveal(from,to)                     │ text    │   │  └──────────────────┘  │
│         ▼ │                                    ▼         │   │           ▲            │
│  ┌──────────────────────────────────────────────────┐    │   │           │            │
│  │ Preview                                          │ postMessage        │            │
│  │  update(files) → coalesce → compile ─────────────┼────┼──►│ compile ──┘            │
│  │  pages ◄── swap only pages whose hash changed ◄──┼────┼───│ {pages, diagnostics}   │
│  │  click (px→pt) ──────────────────────────────────┼────┼──►│ jumpFromClick          │
│  │  onJump(from,to) ◄───────────────────────────────┼────┼───│ {kind:'source',…}      │
│  │  reveal(offset) ─────────────────────────────────┼────┼──►│ jumpFromCursor         │
│  │  flash marker   ◄────────────────────────────────┼────┼───│ [{page,x,y}]           │
│  └──────────────────────────────────────────────────┘    │   └────────────────────────┘
└──────────────────────────────────────────────────────────┘
```

## Modules and their contracts

### `TypstDocument` (`src/document`)

```ts
new TypstDocument(text)
TypstDocument.fromYText(ytext)                   // shared: the text lives in an (integrated) Y.Text
.text
.change(changes: {from, to, insert}[], origin)   // all in pre-change coordinates (CodeMirror ChangeSet semantics)
.setText(text, origin)                           // one minimal change
.share(ytext | null)                             // (re)bind to a Y.Text, adopting its text as one REMOTE_ORIGIN change; null unshares
.onChange((changes, origin) => …) → unsubscribe
REMOTE_ORIGIN                                    // the origin of edits that arrived through the Y.Text
```

- **Single source of truth.** Every view writes through `change()` and reads through `onChange()`.
- **Echo suppression by origin.** A view passes itself as `origin` and ignores notifications whose
  origin is itself.
- **Hidden:** how the text is stored: a string, mirrored into a `Y.Text` when shared. A local
  `change()` updates the string, applies the changes in one `ydoc.transact(…, document)` and
  notifies with the caller's origin; the Y.Text observer skips that transaction. Every other
  transaction (collaborators, a `Y.UndoManager`) becomes `onChange(changes, REMOTE_ORIGIN)`, the
  event delta converted to pre-change changes (`deltaToChanges`, `y-delta.ts`). The views need no
  change. `typst-document.ts` imports Yjs types only, so unshared widgets do not load Yjs.
- **Undo is per user** (decision): each view keeps its own history. Remote changes never enter
  it (the SourceView dispatches them with `addToHistory: false`; the VisualView already does that
  for every outside change), and the histories map over them. A user's Undo reverts the last edit
  of that view's history (the Source view's history also holds the same user's Visual edits), never
  a collaborator's. No `Y.UndoManager`.

### `SourceView` (`src/source-view`)

```ts
new SourceView(parent, document, { onCursor?, onBaseChange? })
.reveal(from, to)    // select, scroll to center, highlight
.setDiagnostics([{severity, message, hints, from, to}])   // underline + hover; replaces previous
.setHighlights(layer, [{from, to, className, attributes?}])  // replaces that layer; follows edits
.selection() → {from, to}
.showChanges(base | null)   // inline unified diff against base, accept/reject per chunk
.destroy()
```

- **Changes:** `@codemirror/merge`'s `unifiedMergeView` in a compartment. Reject edits the
  document like any edit; accept moves CodeMirror's original and reports the new base through
  `onBaseChange`, so the other views stop showing that change too.

- **Hidden:** CodeMirror and its extensions, and the Typst language support
  (`codemirror-lang-typst/lezer`: a pure-JS Lezer parser using typst-syntax node names, plus
  completion and folding; its Lezer syntax linter is left out so that compiler diagnostics are the
  only error source). Also hidden: `@codemirror/lint`, which maps shown diagnostics through later
  edits. Also hidden: translating ChangeSets to and from `TextChange[]`, and the
  annotation that stops document-originated transactions from being written back.

### `Preview` (`src/preview`)

```ts
new Preview(container, { onJump?, onDiagnostics? })   // renders a toolbar + scrolling page area into container
.update(files: Record<path, text | Uint8Array>, main)    // cheap per keystroke
.reveal(path, offset)                        // cheap per cursor move: flash, scroll only if off-screen
.setMarkers(layer, [{path, offset, className, attributes?, title?}])   // margin markers; replaces that layer
.showChanges(path, ranges | null)            // change bars in the page margin, redrawn after every compile
.destroy()
```

- **Change bars** (`change-bars.ts`): the ranges go to the engine's `boxesForRanges` after every
  successful compile; boxes on the same or adjacent lines join into one bar (like LaTeX
  `changebar`). A pure deletion (empty range) takes the characters on either side. Bars are
  page overlays like the highlights; only the newest request draws.

- **Coalescing (`LatestOnly`):** at most one compilation is in flight. Updates that arrive
  meanwhile replace each other, so only the newest gets compiled. Typing never queues a backlog.
  Cursor reveals use the same runner, additionally throttled to one lookup per 80 ms.
- **Incremental, lazy DOM (`PageList`):** every page is a placeholder sized by `aspect-ratio`
  from the page's pt size. An `IntersectionObserver` (root: the preview's scroller, margin: one
  viewport above and below) decides which pages carry their SVG; far pages drop it. Every page
  carries its content `hash`, and only near pages whose hash changed get new SVG markup. An edit
  on page 7 does not touch pages 1–6 in the DOM. Without `IntersectionObserver` all pages render.
- **Zoom:** fit width (default) or a fixed scale (presets 25 %–400 %, 100 % = 1 pt → 4/3 CSS px).
  The page number shown is the page covering most of the viewport.
- **Overlays** (reveal flash, click highlight) are children of the page element, positioned in
  percent of the page, so they survive zoom and lazy unmounting. A click that resolves to a source
  location outlines the clicked text run (Typst draws one as a `<g>` of glyph `<use>`s) until the
  next click or successful compile.
- **Scrolling** only ever moves the preview's own scroller (never `scrollIntoView`), so an embedded
  widget does not scroll its host page.
- **Errors keep the last good pages.** When a compilation fails, the preview keeps showing the
  previous pages, dimmed (`typst-preview--stale`), and reports diagnostics through `onDiagnostics`.
- **Diagnostics are never stale.** `onDiagnostics` is only called when no newer `update()` is
  waiting, so its offsets always refer to the text last passed in.
- **Files:** text is sent with every update (Typst diffs it). Bytes are sent once per
  `Uint8Array` identity: pass the same array again and only `null` crosses to the worker.
- **Packages:** `@preview/…` imports are downloaded on first use (see `withPackages`); the
  diagnostics arrive after the download.
- **Margin markers** (`PreviewMarkers`): per layer, placed with one `cursor` lookup per marker
  (`jumpFromCursor`, first position: page and height) at the right page edge, and placed again
  after every successful compile. Clicks on a marker are not treated as page clicks.
- **Coordinates:** the SVG is scaled to the page element's width (zoom). Clicks are converted with
  `pt = (clientX − pageRect.left) × page.width / pageRect.width`.

### `diffTexts` (`src/diff`)

```ts
diffTexts(base, current) → [{fromA, toA, fromB, toB}]   // A = base, B = current; sorted, UTF-16
```

- The single text diff behind every "Show changes" rendering (the Source view's merge view runs
  the same `@codemirror/merge` algorithm itself, for its accept/reject chunks).
- **Cleanup for readers:** a change inside a word grows to the whole word; a change touching a
  markup delimiter (`*`, `_`, heading `=`, list markers; Lezer tree of either text) grows to the
  whole construct, so `*bold*` → `_bold_` is one change with unchanged visible text. Grown
  ranges are mapped to the other text through the raw changes and merged when they touch.

### Diagnostics in the widget (`src/editor`)

`summarizeDiagnostics(diagnostics, file)` (pure, unit-tested) splits a compile's diagnostics into
those of the shown file and those elsewhere (other files, packages or no location: only listed),
and computes the status label ("✓ compiled" / "1 error, 2 warnings") and the jump target
(`{path, from, to}`: earliest error in the shown file, else in another project file, else the
same for warnings). `DiagnosticsStatus` renders it as a status bar below both panes; clicking the
label, or a listed diagnostic of a project file, opens that file and reveals the range in the
source view. Every document's SourceView gets the diagnostics of its own path.

### `typst-engine` (Rust crate + `src/engine`)

```ts
createEngine(wasm, fonts?: (Uint8Array | Promise<Uint8Array>)[]) → Promise<Engine>
defaultFonts() → Promise<Uint8Array>[]          // src/engine/default-fonts.ts: fetches the bundled font assets
.addFont(bytes)                                  // throws if bytes contain no font face
.setSource(path, text) / .setBinary(path, bytes) / .remove(path)
.compile(main) → { pages: [{hash, width, height, svg}], diagnostics: [{severity, message, hints, path, from, to}], missingPackages: string[] }
.jumpFromClick(page, x, y) → {kind:'source', path, offset, from, to, boxes} | {kind:'url'} | {kind:'position'} | null
.jumpFromCursor(path, offset) → [{page, x, y}]
.boxesForRanges(path, [{from, to}]) → [{page, x, y, w, h}]   // where the drawn text of those ranges is, per glyph run

withPackages(engine, fetchPackage = fetchPreviewPackage) → { compile(main) → Promise<CompileResult> }
fetchPreviewPackage(spec) → Promise<Uint8Array>     // .tar.gz from packages.typst.org, Cache API
untarGz(bytes) → Promise<Map<relativePath, Uint8Array>>
```

Boundary conventions. Each one is decided once, inside the engine:

| Concern | Convention | Why |
|---|---|---|
| Offsets | **UTF-16 code units** | CodeMirror and ProseMirror use them. Typst's UTF-8 byte offsets never leave Rust (`Lines::byte_to_utf16`). |
| Pages | 0-based | JS arrays |
| Coordinates | pt from the page's top-left | the same unit as the page size |
| Results | JSON strings | no serde/JS glue; the TS wrapper parses and types them |
| Paths | absolute project paths (`/main.typ`), package paths (`@preview/name:0.1.0/lib.typ`) | map 1:1 to `FileId` with `VirtualRoot::Project` / `VirtualRoot::Package(spec)`; diagnostics and jumps report package files the same way |

Inside the crate:

- **`MemoryWorld`** implements `typst::World` and `typst_ide::IdeWorld`. Files live in a
  `HashMap<FileId, Source | Bytes>`. `set_source` reuses the existing `Source` (`Source::replace`), so
  Typst reparses incrementally and the spans of unchanged nodes stay stable. **No fonts are
  embedded**: `add_font` pushes each face into the `FontBook` (a `LazyHash`, so comemo sees the
  change). `today()` returns `None`, which keeps output deterministic.
- **Incremental compilation** comes from Typst's own memoisation (`comemo`), which persists across
  `compile` calls because the world lives as long as the engine.
- **Fonts as assets:** `mise run build:fonts` copies Typst's default set (Libertinus Serif,
  New Computer Modern + Math, DejaVu Sans Mono; 17 files, 9.7 MB) from the typst-assets crate
  pinned by `Cargo.lock` into `src/engine/fonts/`. `defaultFonts()` turns them into bundler
  assets (`import.meta.glob(…?url)`) and starts all downloads at once. The worker passes them to
  `createEngine`, which awaits wasm and fonts in parallel.
- **Packages** are files like any other, under their package path. A file of a package with no
  files at all fails with `PackageError::NotFound` and records the spec; `compile` returns those
  as `missingPackages` (cleared per compile). `withPackages` (TS) loops: compile → fetch the
  missing archives in parallel → `untarGz` → `.typ` via `setSource`, the rest via `setBinary` →
  compile again. A failed download is remembered (no retry until reload) and reported as an extra
  diagnostic with `path: null`, next to Typst's own "package not found" at the import.
- **SVG cache:** page SVGs are keyed by `hash128(&page.frame)`. Unchanged pages skip `typst_svg::svg`.
- **Hit-testing:**
  - `typst_ide::jump_from_click(world, document, PagedPosition)` walks the frames of the last
    successful document and gives the exact offset.
  - `highlight.rs` finds the span of the glyph under the click. Its source node range becomes
    `from..to`, and `span_boxes` returns one box per contiguous glyph run of that span (per
    line/page). The preview draws these boxes.
  - For non-text clicks, the range falls back to the syntax leaf at the offset, with no boxes.
  - `jump_from_cursor` is the reverse.
  - `boxesForRanges` walks all glyphs (`highlight::glyph_boxes`) and keeps those whose source
    byte (span range start + the glyph's offset in its span) lies in one of the ranges: character
    precise for text, nothing for markup or code that draws no glyphs.

### `createTypstEditor` / `<typst-editor>` (`src/editor`, `src/element`)

```ts
createTypstEditor(host, { source?, main?, files?, mode?, fileList?, allowFileChange?, onFilesChange?, onChange?,
                           comments?, onCommentsChange?, user?, base?, collaboration? })
  → { source (get/set), files (get/set), activeFile, open(path), comments (get/set, JSON), destroy() }
<typst-editor value="…" file-list="auto|show|hide">   .value, .files, .comments, .user, .collaboration;
  'change' {detail:{value}}, 'files-change' {detail: FileChange}, 'commentschange' {detail:{comments}}
```

- `source` is the text of the main file at `main` (default `/main.typ`; falls back to
  `files[main]`). `files` (`ProjectFiles = Record<path, string | Uint8Array>`) are the project's
  other files. Assigning `files` replaces them (documents of paths that stay are kept and get the
  new text as one edit) and recompiles. `@preview` packages need no entry.
- **Composition** (`Widget`, private): `Project` + `EditingViews` + `FileSwitcher` + `AssetView`
  + `Preview` + `DiagnosticsStatus`. The preview always compiles `main` with `project.files()`.
- **`Project`** (`project.ts`): files by path. `.typ` strings become a `TypstDocument` each (kept
  across renames, so open views survive); everything else is stored as given.
  `check(change)` → reason or null, `apply(change)`, `replace(files)`, `onChange(change)`
  (structural changes and every document edit as `update`). The main file cannot be renamed or
  deleted; `.typ` files keep their ending.
  `FileChange = {kind:'create', path, content} | {kind:'update', path, content} | {kind:'delete', path} | {kind:'rename', from, path}`.
- **`EditingViews`**: one Visual/Source tab bar; a document's views are created the first time
  it is shown and then only hidden, so cursor and undo history survive switching. The mode is
  shared. With a single file the DOM is the same as before (tabs + two panes).
- **`FileSwitcher`**: only turns gestures into `FileChange`s (names via `toPath`: one folder
  level, default extension) and shows refusals inline. Hidden unless `fileList` is `show`, or
  `auto` with more than one file. A requested change passes `project.check`, then the host's
  `allowFileChange` (async allowed; re-checked afterwards), then is applied.
- Preview clicks into another project file open it, then reveal. Clicks into packages are ignored.
- **Insert image** (`AssetView`): `#image("…")` as its own paragraph after the line of the last
  source-view cursor (else at the end) of the last shown `.typ` file, relative path when in the
  same folder tree, else project-absolute.

- Setting `source`/`value` applies **one minimal edit**: only the range between the common prefix
  and the common suffix changes (`minimalChange`), so cursors and undo history are preserved.
- **Styles** go into `host.getRootNode()`: `document.head`, or the element's shadow root.
  CodeMirror mounts its own styles into the same root. Embedding guide: [docs/embedding.md](docs/embedding.md).

### Worker protocol (`src/preview/protocol.ts`)

```
main → worker   {type:'init', wasm}  (first, once; the URL is resolved on the main thread)
main → worker   {id, type:'compile', files: Record<path, text | Uint8Array | null>, main} | {id, type:'click', page, x, y} | {id, type:'cursor', path, offset} | {id, type:'boxes', path, ranges}
worker → main   {id, type:'compile', result} | {id, type:'click', jump} | {id, type:'cursor', positions} | {id, type:'boxes', boxes} | {id, type:'error', message}
```

- Requests are answered in order, because the worker is single-threaded, except that a
  `compile` waiting for a package download lets `click`/`cursor` requests overtake it.
- `compile` sends the full file map; `null` means "the same bytes as last time" (`FileSender`).
  The worker (`FileReceiver`) removes paths missing since the previous call, and Typst diffs the
  text itself. Package files are not part of the map and stay loaded.

### Review comments (`src/comments`)

```ts
new Comments(document, { json?, user?: {name} })
.threads() → [{id, range: {from,to} | null, quote, resolved, comments: [{id, author, time, text}]}]   // orphans first
.add(range, text) → id | null   .reply(id, text)   .setResolved(id, bool)   .remove(id)
.serialize() → json   .load(json)   .onChange(fn) → unsubscribe   .destroy()

new CommentsUI(comments, document, { root, views, activeView(), preview, path })
.panel  .button  .startComment()  .destroy()
```

- **Never in the Typst source.** The host persists `serialize()` beside the file (sidecar JSON
  via `onCommentsChange`). When collaborating they are also in the Y.Doc (`SharedComments`).
- **Live anchors** are offsets mapped through every `TypstDocument` change (`mapRange`): text
  inserted inside a range belongs to it, at its edges it does not. A range whose text is deleted
  becomes an **orphan** (`range: null`, last quote kept). It comes back when exactly that text
  with its context reappears (undo).
- **Persisted anchors** are W3C Web Annotation style `{start, end, exact, prefix, suffix}`
  (TextQuoteSelector, 32 chars of context, plus a position hint). `load()` re-anchors them
  (`reanchor`): first at the old position, else the occurrence of `exact` with the best-matching
  context (nearest wins ties). If the text is not found, the thread is an orphan.
- **Wiring (`CommentsUI`):** highlights go to every view through `setHighlights('comments', …)`
  and markers to `Preview.setMarkers('comments', …)` (unresolved anchored threads only). Both
  are refreshed once per microtask after any change, never inside another view's update. Views
  map their highlights through edits in the meantime. Clicking a highlight or marker
  (`data-comment-id`) selects the thread. Cards reveal their text in the active view.
- **Panel (`CommentsPanel`):** a pure render of `{threads, active, draft}` that reports intents.
  Typed text and focus survive re-renders. It is hidden (zero-width grid column) while empty.

### `VisualView` (`src/visual-view`)

```ts
new VisualView(parent, document)
.reveal(from, to)    // select exactly what shows source range from..to (caret if empty)
.setHighlights(layer, highlights)   // source ranges → inline decorations (sourceToPos, end with bias -1)
.selection() → {from, to}           // posToSource; the end with bias -1
.showChanges(base | null)   // track changes against base, following every edit
.destroy()
```

The editor is **Tiptap 3**, which is ProseMirror underneath. Tiptap provides the keymaps (Mod-B/I,
undo), the input rules (`## ` → heading, `- ` → list) and list handling. The source-of-truth logic
lives in `projection.ts`, which is plain ProseMirror and knows nothing about Tiptap:

```
 text ──typstParser (Lezer)──► CST ──project(text, schema)──► PM doc   (nodes carry attrs.src / attrs.sep)
                                                               │ user edit (PM transaction)
 text ◄── document.setText() (minimal change) ◄── print() ◄────┘   (untouched nodes print attrs.src verbatim)

 text changed elsewhere ──► project() ──► syncDoc(tr, target): smallest replacement, cursor stays put
```

- **Schema** (`extensions.ts`):
  - **Blocks:** `paragraph`, `heading`, and `bulletList` / `orderedList` > `listItem` (a `marker`
    attribute; content `(paragraph | rawBlock) block*`, so nested lists made with Tab print
    indented), plus `rawBlock`.
  - `image` (atom block; `src` is the whole `#image("path", ..)` call, edited like a raw block).
  - `table` > `tableRow` > `tableCell` (Tiptap's MIT table extensions, not resizable); cells hold
    blocks. `table.layout` (an anchor attribute) is the source around the cells.
  - **Inline:** text with `bold` / `italic` / `link` (Tiptap's link mark, `href`) marks;
    `softBreak` (a source newline that renders as a space); `hardBreak` (`\`); `rawInline`.
  - The `typstSource` mark remembers how escapes and shorthands (`\*`, `--`) were written.
  - Anchor attributes are added as Tiptap global attributes and are never rendered.
  - `project()` takes the schema as a parameter. Tiptap builds its own schema instance, and nodes
    must come from that instance.
- **Segmentation:**
  - Headings and list items are blocks of their own.
  - Every other run up to a `Parbreak` becomes a paragraph if it contains prose (Text, Strong,
    Emph, bare URLs, `#link` calls, …). Otherwise it is an `image` if it is exactly one
    `#image("literal path", ..)` call, a `table` if it is exactly one
    `#table(columns: <int>, ..named, [..], ..)` whose positional arguments are all closed content
    blocks filling whole rows, and a `rawBlock` (`#set`, `#let`, display math, figures, …) else.
  - Inline, `#link("plain string")[one paragraph]` puts a `link` mark on its projected content
    (the call syntax is hidden); a bare URL is text with a `link` mark whose `href` is the text.
    Other links stay `rawInline`.
  - A table cell's markup is segmented like the document (paragraphs, lists, headings); an empty
    cell is an empty paragraph.
  - A list item whose source has nested content keeps its body as a `rawBlock`.
- **Separators:**
  - `attrs.sep` is the whitespace between siblings. It is part of node equality.
  - The last child has none; its container owns that whitespace (`list.sep`,
    `doc.lead` / `doc.trail`).
  - Editor-created nodes have `sep: null`, which prints the default: `\n\n` between blocks, `\n`
    between list items.
- **Pristine tracking:**
  - A module-private `WeakMap` holds the nodes created by `project()` (textblocks with their
    source layout). ProseMirror keeps the identity of unchanged nodes, so membership means
    "still equal to `attrs.src`".
  - Pristine nodes print `src`. Edited nodes are printed canonically:
    - text is escaped (`*`, `#`, `$`, `//`, …, and line-start markers);
    - marks become `*x*` / `_x_`, or `#strong[x]` / `#emph[x]` when the span touches a word
      character or whitespace; longer spans open first, so they nest;
    - a link becomes `#link("href")[..]`, or a bare URL when its text is its `href`, a plain
      `http(s)://` URL between whitespace;
    - text right after a `]` that would continue a call (`(`, `.field`) gets a backslash.
  - Tables print their `layout` gaps around the cells' blocks while they keep the projected shape
    (so a cell edit changes only that cell), else canonically: `#table(\n  columns: n,\n`, the
    other named arguments, one `[..], [..],` line per row, `)`. Images print `src`.
- **Position map:** `sourceToPos(doc, offset, bias?)` / `posToSource(doc, pos, bias?)` map between
  source offsets (UTF-16) and document positions at character precision, for any doc (pristine,
  edited or synced).
  - Printing records, for every stretch of the printed source, the document range showing it:
    plain text maps one to one; atoms (raw nodes, breaks, decoded escapes and shorthands) as a
    whole; hidden syntax (delimiters, markers, separators, escape backslashes) maps to the next
    visible position in its block. Pristine textblocks keep the layout of their `src` from
    `project()` in the pristine map, so their verbatim source maps exactly, too.
  - An empty textblock leaves a zero-width span where its content would go, and a table cell's
    closing `]` maps to the end of that cell, so empty cells and list items map back and forth.
  - The table is private and cached per (immutable) doc. `bias: -1` maps a range end to just
    after the preceding visible character (in both directions).
  - Invariants (unit-tested exhaustively on all fixtures and on edited docs): monotonic both
    ways; every visible character maps to itself and back; mapping an offset to a position,
    back and forth again lands on the same position.
- **Write-back:** `document.setText(print(doc))` applies the single minimal change.
- **Read-back:** `syncDoc` replaces only the innermost changed range.
  - It diffs copies of both documents with the anchor attributes stripped. Otherwise a changed
    `src` would make the whole block look different.
  - It then copies the attributes over (`setNodeMarkup`) and marks nodes pristine again wherever
    the target node was pristine.
- **Toolbar** (`toolbar.ts`, created by `VisualView` above the editor): undo/redo, a text style
  menu (normal text, heading 1–3), bold/italic/link, bulleted/numbered list, insert image, insert
  table, add/delete row/column. Each entry is a row in a table of Tiptap chain commands; after
  every transaction the buttons show `aria-pressed` and are disabled when `editor.can()` says no.
  Mousedown is cancelled, so the text keeps focus and selection.
  - Link (and Mod+K in the text) and insert image ask for a value in a `FieldPopover`
    (`field-popover.ts`: one text field, Apply/Enter, optional Remove, Escape or a click outside
    closes). Link with nothing selected inserts the URL as linked text; inside a link it edits or
    removes the whole link.
- **Raw boxes** (`raw-box.ts`): `rawBlock` / `rawInline` / `image` render through a NodeView that
  hosts a nested CodeMirror (Typst highlighting, no own history). An image box is headed by
  "Image: <path>" (`imagePath(src)`); the image itself is not rendered yet.
  - An edit sets `attrs.src` with an attribute step (positions and the outer selection stay put);
    the projection prints `src` verbatim, so the source changes exactly there.
  - An outside change of `src` (via `syncDoc`) reaches the box as one minimal change.
  - Undo/redo in a box run the Visual view's history. Arrow keys at a box's edges, Escape (and Enter
    in inline boxes) move into the outer editor; arrow keys in the outer editor (and Enter on a
    selected box) move into a box; Backspace in an empty box deletes it.
  - Hidden: CodeMirror, the DOM ↔ box lookup, focus hand-over between the two editors.
- **Track changes** (`change-decorations.ts`): a ProseMirror plugin holds the projected base
  and, on every doc change, decorates `diffTexts(print(base), print(doc))` through
  `sourceToPos`: insertions as inline marks, deletions as struck-through `<del>` widgets with
  the deleted *visible* text (taken from the projected base), a change whose visible text is
  the same on both sides as a formatting change, and raw boxes inside a change outlined.
- **Invariants (unit-tested):**
  - `print(project(src)) === src` for every fixture (incl. links, images, tables, unmodelled tables);
  - edits change only what they touch;
  - an outside change to a paragraph keeps the cursor position in it.

### Collaboration (`src/collab`, `server/`)

```ts
createTypstEditor(host, { …, user?: {name, color?},
  collaboration?: { doc: Y.Doc, awareness?: Awareness } | { url, room, token? } })

Collaboration.start(options, { project, comments, user }) → Promise<Collaboration>   // url: waits for the first sync
.sync()   .setCursor(path | null, range?)   .showCursors(path | null, views)   .destroy()
```

**Only text is shared** — ProseMirror/Tiptap and CodeMirror never sync directly; they keep
following their `TypstDocument`. One Y.Doc per project (= Hocuspocus room):

| Y.Doc entry | Content | Kept in step by |
|---|---|---|
| `files`: `Y.Map<path, Y.Text>` | the text of every `.typ` file | `SharedProject` |
| `comments`: `Y.Map<threadId, Y.Map>` | `{anchor: {from, to: RelativePosition JSON, quote}, resolved, comments: Y.Array}` (main file) | `SharedComments` |
| awareness state | `user: {name, color}`, `cursor: {path, anchor, head}` (relative positions) | `RemoteCursors` |

- **`SharedProject`**: binds each project document to its Y.Text (`TypstDocument.share`) and
  keeps the *set* of files in step: local create / rename / delete (and `sync()` after
  `Project.replace`) write the map in one transaction; remote map events become
  `Project.apply(…)` (one delete + one add in one transaction = rename). Joining: the shared files
  win, local files the room lacks are seeded. If two clients seeded a key concurrently, the loser
  rebinds to the winner's Y.Text (one remote change; views and anchors survive). A rename is a new
  Y.Text (its Yjs history starts over); the renaming client keeps its document and views.
- **`SharedComments`**: `Comments` stays the model the UI talks to. Local changes (and anchors
  moved by edits) are diffed against the map and written; remote changes are loaded with
  `Comments.load`, anchors resolved from relative positions (the start sticks to the character
  after it, the end to the one before, matching `mapRange`). Replies are a `Y.Array`, so
  concurrent replies merge. A room without threads is seeded with the local ones.
- **`RemoteCursors`**: publishes the local selection; draws the others' selections
  (`typst-remote-selection`) and carets (`typst-remote-cursor`: one character with a colored
  border and a name label, since views draw marks, not empty ranges) through `setHighlights(
  'remote-cursors', …)` of the shown file's views, re-resolved once per microtask after text or
  presence changes. Color: `--typst-remote-color` per highlight.
- **Widget (`CollaborationLink`)**: `import()`s `src/collab` on demand (own chunk, ~37 kB gzip
  with Yjs and the Hocuspocus provider), publishes the selection on `selectionchange` while focus
  is in the editing area, and moves the cursors along when another file is shown.
- **Server (`server/`)**: `collabConfiguration({ storage?, database?, authenticate?, debounce? })`
  → Hocuspocus configuration; `createCollabServer({ port, … })`. Storage is the extension point
  (`onLoadDocument` / `onStoreDocument`; default `@hocuspocus/extension-sqlite`), for GitLab
  persistence next ([server-gitlab](docs/todo/server-gitlab.md)). `onAuthenticate` calls an
  `Authenticate(token, room)` check; the stub `sharedToken(TYPST_COLLAB_TOKEN)` allows all when
  unset. The server never looks inside the Y.Doc.

## Build and test

| Task | What it does |
|---|---|
| `mise run build:engine` | `cargo build --target wasm32-unknown-unknown --release` + `wasm-bindgen --target web` + `wasm-opt -Oz --strip-debug` → `src/engine/wasm/`, prints raw/gzip/brotli size (skipped when the Rust sources are unchanged) |
| `mise run build:fonts` | default fonts from the pinned typst-assets crate → `src/engine/fonts/` |
| `mise run fixtures:packages` | packs `src/engine/fixtures/<name>-<version>/` into `.tar.gz` (committed) for package tests |
| `mise run dev` | Vite dev server for `demo/` on 127.0.0.1:5199 |
| `mise run build` | engine + typecheck + static demo build → `dist/demo` |
| `mise run build:lib` | library build → `dist/lib`: bundled ESM, worker, wasm, d.ts (`vite.lib.config.ts`, `tsconfig.lib.json`) |
| `mise run test:unit` | vitest (node): engine against the real wasm, document model, (later) projection round-trips |
| `mise run test:e2e` | builds demo + lib, then Playwright against `dist/demo` and `examples/` (+ `dist/lib`), served through request interception (no port needed) |
| `mise run server:dev` | collaboration server on ws://127.0.0.1:1234 (SQLite in `server/.data/`; env `PORT`, `TYPST_COLLAB_DB`, `TYPST_COLLAB_TOKEN`) |
| `mise run server:test` | server tests (vitest, Hocuspocus in-process via `openDirectConnection`, no port) |
| `mise run test:e2e-collab` | starts the server in memory, then the two-user Playwright spec (`tests/e2e/collab.spec.ts`; skipped by `test:e2e`) |
| `mise run quality` / `quality:report` | complexity gate and hot-spot table (see `.claude/skills/code-quality`) |

**Version pins** are all exact:
- Typst 0.15.1: the Rust crates and the CLI in `mise.toml`.
- wasm-bindgen 0.2.129: the crate and the CLI must match.
- binaryen (wasm-opt) 133.
- Rust 1.99.0, Node 24.21.0, pnpm 10.34.6.
- Yjs 13.6.33, y-protocols 1.0.7, Hocuspocus (server, provider, extension-sqlite) 4.7.0.

## Known limitations / next steps

- **wasm is 21 MB raw (8.4 MB gzip, 6.2 MB brotli)**, down from 43 MB (15.8 / 10.6). The rest is
  code (11.7 MB: typst-library 2.7, plus wasmi for plugins, hayro for PDF images, citation/
  hayagriva, image codecs, usvg, serde_yaml/toml/xml loaders) and data (9.4 MB: ICU, syntect
  syntaxes via two-face, hayagriva styles, hyphenation tries). None of it is feature-gated in
  typst 0.15.1, so going further needs a typst fork. `opt-level = "z"` saves another 1.9 MB but
  compiles ~40 % slower, so the crate stays at `"s"`.
- **All 17 default fonts (9.7 MB, 6.4 MB gzip) load before the first render.** Next step: lazy
  fonts — ship a JSON index of `FontInfo` so the `FontBook` is complete up front and fetch font
  data on first use (compile, see which fonts were missing, fetch, recompile).
- **Multi-file UI:** one folder level; no folder tree. The visual view has no cursor API, so
  "Insert into …" uses the last source-view cursor, else the end of the file.
- **Packages:** only `@preview` from packages.typst.org (no configurable registry, no `@local`);
  failed downloads are not retried until the worker restarts.
- **No error display in the visual view** yet (diagnostics only reach the source view).
- **Collaboration:** images and other non-`.typ` files are not shared. `{ doc }` mode needs the
  widget and the host on the same Yjs instance (`dist/lib` bundles its own Yjs). In `{ doc }`
  mode the host must pass a synced Y.Doc; with `{ url }` an unreachable server leaves the widget
  local. Comments are shared for the main file only. Remote cursors at an empty line are not drawn.
- **Visual view images and raw boxes show code**, not the rendered image / snippet (see
  [visual-view-compiled-boxes](docs/todo/visual-view-compiled-boxes.md)). Tables with headers,
  merged cells or `columns: (..)` stay raw boxes.
