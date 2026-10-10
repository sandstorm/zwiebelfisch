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
  document/                 TypstDocument — the single source of truth (string or shared Y.Text); Highlight (a styled source range views draw);
                            margin-note-syntax.ts (drafting's margin-note call: parse, print, validity)
  collab/                   real-time collaboration (loaded on demand): Collaboration, SharedProject, RemoteCursors,
                            RoomVersions + SharedAssets (GitLab rooms); in-process.ts (Y.Doc/awareness
                            wiring for tests); gitlab-protocol.ts (import-free, shared with the server)
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
    snippet.ts              cut a page SVG down to the boxes of a source range (snippets for the Visual view)
  visual-view/              VisualView — Tiptap editor over the source-anchored projection,
                            formatting toolbar, raw boxes edited in a nested CodeMirror,
                            shown rendered (snippet / image) while not focused, notes gutter
                            (notes-gutter.ts, note-list.ts, card-layout.ts)
  editor/                   createTypstEditor() — composes the widget, Visual/Source tabs, status bar, scoped CSS,
                            ChangeTracking (base version + "Show changes" toggle), CollaborationLink
    project.ts              Project: the file model (one TypstDocument per .typ file, main protected)
    editing-views.ts        Visual/Source tabs, lazily one VisualView + SourceView per document
    file-switcher.ts        file bar: tabs, new/upload/rename/delete, drop (optional mode)
    asset-view.ts           read-only image/data view with "Insert into …"
    project-renderings.ts   what a document's Visual view renders and inserts (snippets, image URLs, uploads)
    version-controls.ts     "Save version" button, commit message, outcome; Show changes follows the last commit (GitLab rooms)
    comment-action.ts       "Comment" button / Ctrl+Alt+M: a drafting margin note at the selection of the active view
    add-margin-note.ts      addMarginNote(text, range): the source edits for a new note and the drafting import
    page-margin.ts          noteMarginChanges(text): single-length page margins → room for notes (drafting 0.2.2 bug)
    paths.ts, insert-image.ts, upload.ts   pure helpers (names → paths, Typst path resolution, #image insertion, uploads)
  element/                  <typst-editor> custom element (shadow DOM) around createTypstEditor
  index.ts                  public API of the package; registers <typst-editor>
demo/                       dev/demo page (vite root); ?example=hello|simple|advanced picks a project from demo/examples/<name>/
                            (examples.ts: import.meta.glob → file map), ?room=<name> joins ws://127.0.0.1:1234
server/                     collaboration server (Node package, Hocuspocus; TypeScript run by Node directly)
  src/gitlab/               GitLab-backed rooms: GitLabExtension, GitLabRoom, GitLabProject (REST), merge, commit actions,
                            HTTP endpoints, FakeGitLab (in-process, for tests and server:dev-fake-gitlab)
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
  only error source; its indentation service is wrapped so that Enter right after a closed
  construct like `#set page(..)` does not indent, which 0.6.0 gets wrong). Also hidden: `@codemirror/lint`, which maps shown diagnostics through later
  edits. Also hidden: translating ChangeSets to and from `TextChange[]`, and the
  annotation that stops document-originated transactions from being written back.

### `Preview` (`src/preview`)

```ts
new Preview(container, { onJump?, onDiagnostics? })   // renders a toolbar + scrolling page area into container
.update(files: Record<path, text | Uint8Array>, main)    // cheap per keystroke
.reveal(path, offset)                        // cheap per cursor move: flash, scroll only if off-screen
.showChanges(path, ranges | null)            // change bars in the page margin, redrawn after every compile
.snippet(path, from, to, text) → Promise<{svg, width, height} | null>   // the range as drawn, cut from its page
.onRender(listener) → unsubscribe            // after every successful compile
.destroy()
```

- **Snippets** (`snippet.ts`): no extra compilation. After running compiles are done, the range
  goes to `boxesForRanges`; the union of the boxes on the first box's page (+2 pt, clamped to
  the page) becomes the page SVG with that `viewBox` and size in pt. Null when the range draws
  nothing, or when `text` is not what the range held at the last successful compile (it was
  edited since, or the document has errors), so a snippet never shows other source.

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
source view, switching to the Source tab. Hovering or focusing the label lists the shown file's
messages (with hints), each jumping to its range. Every document's views get the diagnostics of
their own path: the Source view as CodeMirror lint (underline + hover), the Visual view as the
`diagnostics` highlight layer (wavy underline, message + hints as tooltip; raw code boxes in range
are outlined, since inline decorations skip block atoms; an empty range marks one character).

### `typst-engine` (Rust crate + `src/engine`)

```ts
createEngine(wasm, fonts?: (Uint8Array | Promise<Uint8Array>)[]) → Promise<Engine>
defaultFonts() → Promise<Uint8Array>[]          // src/engine/default-fonts.ts: fetches the bundled font assets
.addFont(bytes)                                  // throws if bytes contain no font face
.setSource(path, text) / .setBinary(path, bytes) / .remove(path)
.compile(main) → { pages: [{hash, width, height, svg}], diagnostics: [{severity, message, hints, path, from, to}], missingPackages: string[] }
.jumpFromClick(page, x, y) → {kind:'source', path, offset, from, to, boxes} | {kind:'url'} | {kind:'position'} | null
.jumpFromCursor(path, offset) → [{page, x, y}]
.boxesForRanges(path, [{from, to}]) → [{page, x, y, w, h}]   // where those ranges are drawn: per glyph run, shape, image

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
  - `boxesForRanges` walks all frame items (`highlight::drawn_boxes`) and keeps glyphs whose
    source byte (span range start + the glyph's offset in its span) lies in one of the ranges
    (character precise for text), plus shapes (rules, fraction lines, rectangles; stroke
    included) and images whose span's node starts in one. Code that draws nothing yields nothing.

### `createTypstEditor` / `<typst-editor>` (`src/editor`, `src/element`)

```ts
createTypstEditor(host, { source?, main?, files?, mode?, fileList?, allowFileChange?, onFilesChange?, onChange?,
                           user?, base?, collaboration? })
  → { source (get/set), files (get/set), activeFile, open(path), setBase(base), destroy() }
<typst-editor value="…" file-list="auto|show|hide">   .value, .files, .user, .collaboration, setBase(base);
  'change' {detail:{value}}, 'files-change' {detail: FileChange}
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
  `allowFileChange` (async allowed; re-checked afterwards), then is applied. Files dropped
  anywhere on the widget are uploaded while the bar shows, else ignored — never left to the
  browser, which would open the file in place of the page. Image files dropped into the Visual
  view's text are taken there instead (uploaded and inserted at the drop point).
- Preview clicks into another project file open it, then reveal. Clicks into packages are ignored.
- **`ProjectRenderings`** gives every document's VisualView its `renderer` (snippets from
  `Preview.snippet` under the document's current path, refreshed on `Preview.onRender`; image
  files resolved like Typst (`resolvePath`) and shown as object URLs, made once per content and
  revoked when replaced) and `assets` (the project's images as `referencePath`s; uploads become
  a `create` change that goes through `allowFileChange` like the file bar's; an upload equal to
  an existing file (`name.png`, `name-2.png`, …) reuses it, a different one gets the first free
  of those names — every pasted screenshot is `image.png`; refusals — not an image Typst shows,
  the host's veto — come back as an error the popover shows).
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

### Comments = margin notes (`src/document/margin-note-syntax.ts`, `src/editor/comment-action.ts`, `add-margin-note.ts`, `page-margin.ts`, `src/visual-view/margin-notes.ts`, `notes-gutter.ts`, `note-list.ts`, `card-layout.ts`)

Comments are [`drafting`](https://typst.app/universe/package/drafting/) margin notes in the
Typst source itself (`@preview/drafting:0.2.2`): `#margin-note[note]` (point, at a cursor) and
`#margin-note[text][note]` (range: drafting highlights `text`). There is no other comment store:
the preview shows what the compiler draws, and git, diffs, undo and collaboration carry notes as
ordinary text. No threads: a reply is more text in the note, resolving means deleting the call,
and an author is whatever the note's text says. Hiding notes for the final output
(`#set-margin-note-defaults(hidden: true)`) is up to the author.

```ts
// margin-note-syntax.ts: the only module that knows drafting's call syntax
parseNoteCall(src) → {head, text?, note} | null     // head: `#margin-note` plus any `(..named)`
printNoteCall({head, text?, note}) → string         // printNoteCall(parseNoteCall(src)) === src
noteCallSyntax(source, funcCallNode) → {head, text: ContentBlock | null, note} | null   // in a parsed tree
isNoteCallAt(source, from, to) → boolean            // one note call in markup from `#` to exactly `to`
safeNote(markup) → string | null                    // markup that cannot end or swallow its call
addMarginNote(text, {from, to}) → {changes: TextChange[], note} | null   // note: offset of the new (empty) body
new CommentAction(root, () => {document, view: {selection(), reveal(), editNote?()}} | null)   .button  .comment()  .destroy()
VisualView.editNote(offset) → boolean   // focuses the gutter card of the note whose source holds offset
// src/visual-view: the notes gutter
new NotesGutter(body)   .plugin (add to the editor state)  .edit(offset) → boolean  .destroy()
layoutCards([{anchor, height}], {gap, active?, top?}) → tops   // pure: cards beside anchors, no overlap
findNotes(doc) / followNotes(prev, mapping, found, newKey) / setNoteText(tr, note, markup) / removeNote(tr, note)
noteAtSelection(notes, selection) / noteAtOffset(notes, doc, offset)   // note-list.ts, pure ProseMirror
```

- **Syntax** (`margin-note-syntax.ts`): a note is `#margin-note(..named)[note]` or
  `#margin-note(..named)[text][note]` with no syntax errors, a non-empty one-paragraph `text`
  and nothing after the last `]`; any other `margin-note` call is ordinary code. Projection,
  the Visual view and `addMarginNote` all use this one definition.
- **`addMarginNote`** (pure): a selection becomes `#margin-note[selection][]` if the result
  is one note call in markup (`isNoteCallAt`); else (half of `*bold*`, two paragraphs) a
  point note `#margin-note[]` at the selection's end; null where none fits (inside code). The
  import is ensured exactly once: an existing top-level drafting import (any version) that ends
  before the note is kept (`*`, or `margin-note` among its items) or extended (`, margin-note`
  after its last item, also after a trailing comma; `: margin-note` on a bare module import);
  else `#import "@preview/drafting:0.2.2": margin-note` goes first in the file (a drafting
  import below the note would not bind the name where the note is).
- **Page margins** (`src/editor/page-margin.ts`, part of `addMarginNote`'s edits, same undo
  step): drafting 0.2.2 crashes with "type relative length has no method `keys`" when the page
  margin is a single length ([drafting.typ line 640](https://github.com/typst/packages/blob/main/packages/preview/drafting/0.2.2/drafting.typ#L640)
  calls `page.margin.keys()` on anything but `auto`), and Typst turns uniform dictionaries
  (`(rest: a)`, `(x: a, y: a)`) back into a length. So every top-level `#set page(.., margin: m)`
  with such a literal `m` (a length, a sum of lengths, or a side dictionary with one value for
  all four sides) becomes `margin: (right: R, rest: m)`: only the margin argument changes. R is
  4cm (room for drafting's notes), or the next whole cm + 1 when `m` is an absolute length of
  4cm or more (equal sides would be uniform again). `auto`, absent and non-uniform margins,
  variables and spreads are never touched.
- **`CommentAction`**: the widget's only comment UI — the "Comment" button and Ctrl/Cmd+Alt+M
  (captured at the widget root). Works on the shown `.typ` file in the current view
  (`EditingViews.shown()`), applies the edits as one `document.change`, then
  `VisualView.editNote(note)` focuses the new note's card, or the Source view puts the caret into `[]`.
- **Visual view, in the text** (`margin-notes.ts`): see `marginNote` / `noteRange` below. A point
  note is a small marker (tooltip: its note), a range note's text is highlighted.
- **Visual view, notes gutter** (`notes-gutter.ts`, like the comment sidebar of Google Docs or
  Tiptap's comments): a column right of the text (`.typst-visual__body` holds the editor DOM and
  the gutter; the column only shows while the document has notes) with a card per note, in
  document order: the highlighted text (range notes), the note's markup in a multi-line text
  area, and "Resolve note".
  - Editing: Mod+Enter or leaving the field writes the markup back through `safeNote` (brackets
    without a partner escaped, or all of it escaped as plain text if the markup would still
    break the call) as one transaction (one undo step) setting the `note` attribute of the atom
    or mark; everything else stays as written. Escape restores the field. Mod+Enter and Escape put
    the text cursor after the note. Resolve deletes a point note's atom, or only the `noteRange`
    mark of a range note (its text stays), one undo step.
  - State: a ProseMirror plugin keeps the notes as a list (`note-list.ts`: `findNotes` on every
    doc change, `followNotes` maps the previous notes through the transaction's mapping to keep
    each note's key; a range note may change at one end). The plugin decorates every anchor with
    `data-note-key` (node decoration on a marker, inline decoration over a range) plus
    `--active` / `--hover` classes. The active note is the one at the cursor (innermost range
    note, or a selected marker), a focused card's, or a clicked marker's; hover comes from the
    anchor or the card. Cards are DOM outside ProseMirror, reconciled by key: an open card keeps
    its field and the user's text while the document changes from elsewhere and saves into its
    own note; a card whose note is gone saves nothing.
  - Layout (`card-layout.ts`, pure): cards start at their anchor's top, pushed down below the
    previous card (gap 8px); the active card stays at its anchor and cards above it move up (not
    above the gutter's top). Measuring (anchor rects, card heights; all reads, then writes) runs
    in one `requestAnimationFrame` after a doc change, an active-note change, typing in a card,
    or a resize of the body or the text (`ResizeObserver`, which also covers loaded images; plus
    captured `load` events). No measuring in the projection.
  - Narrow (body narrower than 640px): no column; only the active note's card shows, as a
    popover below its anchor.
  - `editNote(offset)` finds the note in the document: a point note whose call holds `offset`, or
    among range notes whose text ends at the same place (nested) the one whose `][note]` holds it,
    makes it active and focuses its card.
- **Source view**: plain Typst, no extra decoration.
- Engine tests compile both forms against the real package (`src/engine/fixtures/drafting-0.2.2`).
- **Removed** with this design (it replaced the sidecar comments of docs/todo/comments.md):
  `src/comments` (Comments, quote anchors, CommentsPanel, CommentsUI), `SharedComments` and the
  Y.Doc `comments` map, `Preview.setMarkers` / `PreviewMarkers`, the widget options `comments` /
  `onCommentsChange`, the `comments` getter/setter, the element's `.comments` and
  `commentschange`, and the `CommentsData` / `TypstEditorCommentsChangeDetail` types.

### `VisualView` (`src/visual-view`)

```ts
new VisualView(parent, document, { renderer?, assets? })
.reveal(from, to)    // select exactly what shows source range from..to (caret if empty)
.setHighlights(layer, highlights)   // source ranges → inline decorations (sourceToPos, end with bias -1)
.selection() → {from, to}           // posToSource; the end with bias -1
.editNote(offset) → boolean         // focuses the gutter card of the margin note whose source holds offset
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
  - `image` (atom block; `src` is the whole `#image("path", ..)` call, edited like a raw block);
    `outline` likewise for `#outline(..)` (the table of contents).
  - `figure` > `image` (the call without `#`) + optional `figureCaption` (a textblock).
    `figure.layout` (an anchor attribute) is the source around the two: `open`, caption
    `before`/`open`/`close`, and `rest` (other arguments, `)`, a label).
  - `codeBlock` (Tiptap's, `language` + anchor `fence`): plain text (no marks), edited in place.
  - `table` > `tableRow` > `tableCell` / `tableHeader` (Tiptap's MIT table extensions, not
    resizable); cells hold blocks. `table.layout` (an anchor attribute) is the source around the
    cells.
  - `taskList` > `taskItem` (Tiptap's, `checked`; one paragraph, not nested; `nodes/task-list.ts`).
  - `blockquote` (Tiptap's; holds blocks; `layout` is the source around its content).
  - `pageBreak`, `horizontalRule` (atom blocks keeping their call as `src`, shown as a labelled
    dashed divider / a rule; `nodes/page-break.ts`, `nodes/horizontal-rule.ts`).
  - `alignment` (`text-align.ts`): `#align(args)[blocks]`, content `block+`. `args` is the
    literal alignment as written; `layout` (an anchor) is the source around the blocks.
    Paragraphs have a `justify` attribute (`true` / `false` / `null`) for
    `#par(justify: ..)[text]`.
  - **Inline:** text with `bold` / `italic` / `link` (Tiptap's link mark, `href`) / `code`
    (Tiptap's, extended: combines with other marks; `fence` and `lang` remember ```lang …```) marks;
    `softBreak` (a source newline that renders as a space); `hardBreak` (`\`); `rawInline`.
  - **Margin notes:** `marginNote` (inline atom) and the `noteRange` mark over the highlighted
    text, both with `head` (source before the first `[`) and `note` (the note's markup), printed
    by `margin-note-syntax`. `noteRange` also has an unprinted `id`, the note's number in its
    textblock, so equal neighbouring notes stay two marks; `excludes: ''`, so notes nest.
  - The `typstSource` mark remembers how escapes and shorthands (`\*`, `--`) were written.
  - Anchor attributes are added as Tiptap global attributes and are never rendered.
  - `project()` takes the schema as a parameter. Tiptap builds its own schema instance, and nodes
    must come from that instance.
- **Segmentation:**
  - Headings and list items are blocks of their own.
  - Every other run up to a `Parbreak` becomes a paragraph if it contains prose (Text, Strong,
    Emph, inline raw, bare URLs, `#link` calls, …) — unless it is exactly one raw element Typst
    shows as a block (3+ backticks around a line break), which is a `codeBlock`. Otherwise, if it
    is exactly one call (`BLOCK_CALLS`, then `callAtomType` in `call-atoms.ts`): an `image` for
    `#image("literal path", ..)`, an `outline` for `#outline(..)`, a `figure` for
    `#figure(image("literal path", ..), ..named)` (optionally followed by a label) whose
    `caption: [..]`, if any, is one paragraph, a `table` for
    `#table(columns: <int>, ..named, [..], ..)` whose positional arguments are all closed content
    blocks filling whole rows (the first row may be a `table.header(..)` of content blocks: header
    cells), an `alignment` for `#align(<literal alignment>)[..]` (`left|center|right|start|end`,
    optionally `+` one vertical alignment), a paragraph with `justify` for
    `#par(justify: <bool>)[one paragraph]`, a `blockquote` for `#quote(block: true, ..named)[..]`,
    a `pageBreak` for `#pagebreak(..)`, a `horizontalRule` for `#line(length: 100%, ..)` without
    `start`/`end`/`angle`; a `rawBlock` (`#set`, `#let`, display math, …) else. Alignment, quote
    and table-cell content is segmented like the document.
  - A bullet item `- [ ] text` / `- [x] text` (one paragraph) is a `taskItem`; the box is hidden
    syntax. Consecutive items of the same list type (bullet, ordered, task) form one list.
  - Inline, `#link("plain string")[one paragraph]` puts a `link` mark on its projected content
    (the call syntax is hidden); a bare URL is text with a `link` mark whose `href` is the text.
    Other links stay `rawInline`.
  - Raw text (`raw-code.ts` reads a `Raw` node): a code block's text is the source between the
    delimiters, the language tag and the whitespace Typst trims (not dedented); inline raw on one
    line is its text with a `code` mark. Empty and multi-line inline raw stays `rawInline`.
  - A margin note call (as `noteCallSyntax` defines it) becomes a `marginNote`, or for the range
    form a `noteRange` mark on the projected `text`, and counts as prose. Other `margin-note`
    calls stay `rawInline` (or a `rawBlock` on a line of their own).
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
    - text right after a `]` that would continue a call (`(`, `.field`) gets a backslash;
    - code text is printed as is, innermost (closed and reopened around other formatting
      changes), in single backticks where possible, else in a fence longer than any backtick run
      inside (`` ``` a`b``` ``, a space before the closing fence after a trailing backtick);
    - an edited code block prints ```` ```lang\ntext\n``` ````, keeping its fence unless the text
      needs a longer one; the language is cut to what Typst reads as a tag (`codeLanguage`).
  - Tables print their `layout` gaps around the cells' blocks while they keep the projected shape
    and header state (so a cell edit changes only that cell), else canonically:
    `#table(\n  columns: n,\n`, the other named arguments, one `[..], [..],` line per row (the
    first in `table.header(..)` if it is a header row), `)`. Block atoms with a `src` (raw blocks,
    images, outlines, page breaks, rules) print it. A quote prints its `layout` (new:
    `#quote(block: true)[` / `]`) around its blocks; a task item `- [x] ` / `- [ ] ` and its paragraph.
  - Figures print their layout around the image call and the caption, so each changes on its
    own; an added caption prints `, caption: [..]` right after the image call, a removed one
    drops its argument with the comma before it. Editor-made figures print
    `#figure(image(..), caption: [..])`.
  - Alignment blocks print their `layout` around their blocks, with only `#align(args)`
    re-printed when `args` changed. New ones print `#align(x)[A\n\nB]`. An edited paragraph with
    `justify` prints `#par(justify: x)[..]` around its inline content.
  - Edited blocks are printed through `PRINT_BLOCK` (by node type; textblocks by default).
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
  menu (normal text, heading 1–3), numbered headings, bold/italic/code (Mod+E)/link,
  bulleted/numbered list, code block, task list, quote, text alignment, insert image, table of
  contents (an `#outline()` block at the cursor), insert table, add/delete row/column, header row,
  insert page break, horizontal rule (the block-node entries live in `toolbar-blocks.ts`; `Action`
  in `toolbar-action.ts`). Each entry is a row in a table of Tiptap chain commands; after
  every transaction the buttons show `aria-pressed` and are disabled when `editor.can()` says no.
  Mousedown is cancelled, so the text keeps focus and selection.
  - Link (and Mod+K in the text) and insert image ask for a value in a `FieldPopover`
    (`field-popover.ts`: one text field, Apply/Enter, optional Remove, Escape or a click outside
    closes). Link with nothing selected inserts the URL as linked text; inside a link it edits or
    removes the whole link.
  - With `assets` (`ImageAssets`: `list()`, `upload(file)` → `{ path } | { error }`), the image
    popover also lists the project's images and offers "Upload image…" (`image-choices.ts`;
    refusals show in the popover); either inserts an `#image("path")` block. With `assets`,
    image files dropped on or pasted into the text are uploaded and inserted as well
    (`imageFileDrops`; the drop stops there, refusals open the popover).
  - Image blocks (`image-insertion.ts`) go after the selected block, or after the paragraph /
    heading holding the cursor (an empty paragraph is replaced): never replacing or splitting
    content — the initial selection is a node selection on the first raw block (often
    `#set page(..)`).
- **Text alignment** (`text-align.ts`, `alignment.ts` for the Typst syntax):
  - Commands `setTextAlign(left|center|right|justify)` and `unsetTextAlign`; shortcuts
    Mod-Shift-L/E/R/J; four toolbar buttons pressed by `textAlignAt(state)`.
  - Horizontal alignment wraps the selected blocks (in the doc, an alignment block or a table
    cell) in one alignment block. A value equal to the surrounding alignment removes the wrapper
    instead, a partly selected wrapper is split (lifted blocks get default separators), and a
    wrapper with a vertical part keeps it.
  - Justify is per paragraph (not headings or list items) and removes horizontal wrappers.
  - The scope (default alignment) comes from enclosing alignment blocks and from
    `#set align(..)` / `#set par(justify: ..)` in earlier raw-block siblings of each ancestor.
    Commands only write what differs from it. A plugin decorates every textblock with its
    effective `text-align`.
- **Code blocks** (`code-block-view.ts`): a NodeView with a header holding a "Language" field
  (accepts only a valid tag, sets `language` as one types; Enter/Escape/ArrowDown go to the
  code) above a `<pre><code>` content DOM.
- **Raw boxes** (`raw-box.ts`): `rawBlock` / `rawInline` / `image` / `outline` render through a
  NodeView that hosts a nested CodeMirror (Typst highlighting, no own history). An image box is
  headed by "Image: <path>" (`imagePath(src)`), an outline box by "Table of contents"; with a
  renderer, the outline shows its compiled snippet.
  - **Rendered boxes** (`rendered-box.ts`, with a `BoxRenderer`): while not focused, a box shows
    an `<img>` instead of its code: an `image` box its file (`renderer.imageUrl(path)`, follows
    path edits at once), any other box the compiled snippet of its source range
    (`renderer.snippet(from, to, src)` as an SVG data URL, sized in pt; refreshed on
    `renderer.onChange`). Boxes starting with `#set`/`#show`/`#let`/`#import`/`#include` or a
    comment (`rendersInPlace`) and boxes whose snippet is null keep showing code. Focus in
    the code (click on the picture — for images: double-click —, arrow keys, Enter) shows the
    code; focus leaving it shows the picture again.
  - An edit sets `attrs.src` with an attribute step (positions and the outer selection stay put);
    the projection prints `src` verbatim, so the source changes exactly there.
  - An outside change of `src` (via `syncDoc`) reaches the box as one minimal change.
  - Undo/redo in a box run the Visual view's history. Arrow keys at a box's edges, Escape (and Enter
    in inline boxes) move into the outer editor; arrow keys in the outer editor (and Enter on a
    selected box) move into a box; Backspace in an empty box deletes it.
  - Hidden: CodeMirror, the DOM ↔ box lookup, focus hand-over between the two editors. The
    nested CodeMirror gets the outer editor's root (the shadow root inside `<typst-editor>`):
    it is created before its box is attached, so it could not find that root itself and would
    read focus and selection from the document.
- **Image tools** (`image-tools.ts`, added to every `image` box): the "Image: path" heading, a
  frame around the rendered picture sized from the call's `width` (`imageWidthCss`), and,
  while the image is selected (a click on the picture selects it; double-click, Enter or
  "Edit code" open the code): resize handles (corners, sides) and an "Image" toolbar
  (Add/Remove caption, Width 25/50/75/100 %, Alt text popover). A drag resizes live and writes
  `width: NN%` (whole percent of the text width, any other unit replaced) on release.
  - Every action is one transaction from `image-edits.ts` (one undo step): `addCaption`
    (image → figure with an empty caption, cursor in it), `removeCaption` (a figure without
    label/other arguments → `#image(..)` again, else only the caption goes), `resizeImage`,
    `setImageAlt`. `image-call.ts` edits one argument of the call in place (replace the value,
    append after the last argument, or remove with the preceding comma).
- **Input rules** (Tiptap's, plus ours): `> ` quote, `[ ] ` / `[x] ` task item; `---` (`—-`,
  `___ `, `*** `) becomes a rule only when it is the whole paragraph, since `---` is an em dash in
  Typst markup.
- **Task lists need cheq** (`checklist-preamble.ts`): Typst has no checkboxes; the Universe package
  cheq (pinned 0.4.0) draws `- [ ]` items as boxes under `#show: checklist`.
  `ensureChecklistPreamble(tr)` adds what is missing of its import and show rule to the top-level
  raw blocks, once; the `ChecklistPreamble` plugin calls it when a Visual edit (not a sync from the
  source) adds a task item, as an appended transaction (same undo step).
- **Heading numbers** (`numbering.ts`, `heading-numbering.ts`, `nodes/heading-numbers.ts`):
  `headingNumbers(doc)` follows top-level `#set heading(numbering: ..)` rules and Typst's heading
  counter; `numberingFormatter(pattern)` applies Typst numbering patterns (`1 a A i I * ①`;
  others → no numbers). A plugin draws them as node decorations (`data-heading-number`, CSS
  `::after` in a gutter right of the text; the editor gets `typst-visual--numbered`). Command
  `toggleHeadingNumbering` adds `#set heading(numbering: "1.")` after the leading raw blocks or
  removes the numbering arguments. Rules in content blocks, show rules and numbering functions are
  not followed (the preview is exact).
- **Track changes** (`change-decorations.ts`): a ProseMirror plugin holds the projected base
  and, on every doc change, decorates `diffTexts(print(base), print(doc))` through
  `sourceToPos`: insertions as inline marks, deletions as struck-through `<del>` widgets with
  the deleted *visible* text (taken from the projected base), a change whose visible text is
  the same on both sides as a formatting change, and raw boxes inside a change outlined.
- **Invariants (unit-tested):**
  - `print(project(src)) === src` for every fixture (incl. links, images, figures, tables, unmodelled
    tables and figures, quotes, page breaks, rules, table headers, task lists);
  - edits change only what they touch;
  - an outside change to a paragraph keeps the cursor position in it.

### Collaboration (`src/collab`, `server/`)

```ts
createTypstEditor(host, { …, user?: {name, color?},
  collaboration?: { doc: Y.Doc, awareness?: Awareness } | { url, room, token? } })

Collaboration.start(options, { project, user }) → Promise<Collaboration>   // url: waits for the first sync
.sync()   .setCursor(path | null, range?)   .showCursors(path | null, views)   .destroy()
.versions → RoomVersions | null      // GitLab rooms: .base(path), .onBaseChange(fn), .save(message, author?), .onMessage(fn)
```

**Only text is shared** — ProseMirror/Tiptap and CodeMirror never sync directly; they keep
following their `TypstDocument`. One Y.Doc per project (= Hocuspocus room):

| Y.Doc entry | Content | Kept in step by |
|---|---|---|
| `files`: `Y.Map<path, Y.Text>` | the text of every `.typ` file | `SharedProject` |
| awareness state | `user: {name, color}`, `cursor: {path, anchor, head}` (relative positions) | `RemoteCursors` |
| `assets`: `Y.Map<path, sha \| Uint8Array>` | GitLab rooms only: the other files (blob sha, or uploaded bytes not committed yet) | `SharedAssets` (clients), `GitLabRoom` (server) |
| `meta`: `Y.Map` | GitLab rooms only, written by the server: `baseSha`, `base` (path → text), `baseAssets` (path → sha), `lastCommits` (path → commit) | `GitLabRoom`; read by `RoomVersions` |

- **`SharedProject`**: binds each project document to its Y.Text (`TypstDocument.share`) and
  keeps the *set* of files in step: local create / rename / delete (and `sync()` after
  `Project.replace`) write the map in one transaction; remote map events become
  `Project.apply(…)` (one delete + one add in one transaction = rename). Joining: the shared files
  win, local files the room lacks are seeded. If two clients seeded a key concurrently, the loser
  rebinds to the winner's Y.Text (one remote change; views survive). A rename is a new
  Y.Text (its Yjs history starts over); the renaming client keeps its document and views.
- **`RemoteCursors`**: publishes the local selection; draws the others' selections
  (`typst-remote-selection`) and carets (`typst-remote-cursor`: one character with a colored
  border and a name label, since views draw marks, not empty ranges) through `setHighlights(
  'remote-cursors', …)` of the shown file's views, re-resolved once per microtask after text or
  presence changes. Color: `--typst-remote-color` per highlight.
- **Widget (`CollaborationLink`)**: `import()`s `src/collab` on demand (own chunk, ~37 kB gzip
  with Yjs and the Hocuspocus provider), publishes the selection on `selectionchange` while focus
  is in the editing area, and moves the cursors along when another file is shown.
- **Server (`server/`)**: `collabConfiguration({ storage?, database?, authenticate?, debounce?, gitlab? })`
  → Hocuspocus configuration; `createCollabServer({ port, … })`. Storage keeps every room's Yjs
  state (`onLoadDocument` / `onStoreDocument`; default `@hocuspocus/extension-sqlite`).
  `onAuthenticate` calls an `Authenticate(token, room) → {name?, email?}` check; the stub
  `sharedToken(TYPST_COLLAB_TOKEN)` allows all when unset. The server looks inside the Y.Doc
  only in GitLab rooms.

#### GitLab-backed rooms (`server/src/gitlab`, `src/collab/room-versions.ts`, `shared-assets.ts`)

A room named `gitlab:<project id or path>@<branch>` is that branch (`parseRoomName`). The server
config (`gitlab: {url, token, webhookSecret?, authorEmail?, fetch?}`, from `TYPST_GITLAB_*` in
`main.ts`) holds the only GitLab token. Protocol (`src/collab/gitlab-protocol.ts`):

```
client → server  stateless {type:'gitlab:save', message?, author?: {name, email?}}
server → all     stateless {type:'gitlab:saved', sha, author} | {type:'gitlab:merged', sha} | {type:'gitlab:conflict', sha, files: [{path, ranges: [{from,to}]}]}
server → saver   stateless {type:'gitlab:unchanged'} | {type:'gitlab:error', message}
HTTP             GET /rooms/<room>/files/<path> (Authorization: Bearer <room token>) → bytes;  POST /gitlab/webhook (X-Gitlab-Token)
```

- **`GitLabExtension`** (Hocuspocus extension, priority below storage): `onLoadDocument` makes a
  `GitLabRoom` per open GitLab room and `open()`s it; `onStateless` runs saves and routes the
  outcome; `onRequest` → `handleHttp` (framework-free, `http.ts`): room files and push webhooks
  (merge into the open rooms of that project + branch, tell their clients).
- **`GitLabRoom`** (one per open room; operations queued one at a time; all state in the Y.Doc,
  so it survives storage round trips):
  - `open()`: no `meta` yet → load the branch head: tree (all pages) → `.typ` via the Files API
    (text + `last_commit_id`), other files by blob sha → `files`, `assets`, `meta`. A stored room
    instead pulls (below), ignoring GitLab being unreachable.
  - `save(author, message)`: `commitActions(meta, files)` (update / create / delete, `move` for a
    deleted+created pair with ≥ 50 % equal lines, uploads as base64, asset renames by sha) → one
    `POST /repository/commits`. Optimistic concurrency per file: update/move/delete carry the
    file's `last_commit_id`, so GitLab refuses if it changed upstream (GitLab checks it per action,
    not against the branch head). On a refusal with a moved head: merge upstream, try again (3×);
    a conflict ends the save. On success the committed snapshot becomes the base (uploads become
    their blob sha); if the commit's parent is not our base (a push to other files landed between),
    that upstream is merged right away.
  - Merge (save, webhook, reopen): `mergeFiles(base, room, upstream)` per path: taken from
    upstream where the room did not change it, kept where upstream did not; both changed →
    `merge3` (node-diff3, by lines; adjacent-line changes conflict like diff3); changed vs deleted
    → conflict. Any conflict → nothing applied, `gitlab:conflict` with the room's ranges.
    Otherwise applied in one transaction as `textEdits` (changed lines narrowed to the differing
    characters, so cursors elsewhere stay put) and `meta` = upstream.
    Assets: upstream wins where the room did not change them.
  - `BlobCache` (shared, LRU by bytes) keeps blob bytes by sha for the files endpoint.
- **Widget**: `Collaboration` (server mode only) sees `meta.baseSha` after the first sync and adds
  `RoomVersions` (base per path + `onBaseChange`, `save`, `onMessage` over the provider's
  stateless channel) and `SharedAssets` (assets ↔ project's other files; repository files
  fetched from the files endpoint, uploads as bytes; bytes → sha after a commit is not a
  change). `CollaborationLink` passes `versions` to the widget, which mounts `VersionControls`
  (`src/editor/version-controls.ts`): "Save version" + commit-message popover + status line, and
  `ChangeTracking.setBase(base of main)` on every base change, so "Show changes" resets for
  everyone after a save.

## Build and test

| Task | What it does |
|---|---|
| `mise run build:engine` | `cargo build --target wasm32-unknown-unknown --release` + `wasm-bindgen --target web` + `wasm-opt -Oz --strip-debug` → `src/engine/wasm/`, prints raw/gzip/brotli size (skipped when the Rust sources are unchanged) |
| `mise run build:fonts` | default fonts from the pinned typst-assets crate → `src/engine/fonts/` |
| `mise run fixtures:packages` | packs `src/engine/fixtures/<name>-<version>/` into `.tar.gz` (committed) for package tests |
| `mise run dev` | Vite dev server for `demo/` on 127.0.0.1:5199 |
| `mise run build` | engine + typecheck + static demo build → `dist/demo` |
| `mise run build:lib` | library build → `dist/lib`: bundled ESM, worker, wasm, d.ts (`vite.lib.config.ts`, `tsconfig.lib.json`) |
| `mise run test:unit` | vitest (node): engine against the real wasm, document model, projection round-trips, demo examples compile |
| `mise run test:e2e` | builds demo + lib, then Playwright against `dist/demo` and `examples/` (+ `dist/lib`), served through request interception (no port needed) |
| `mise run server:dev` | collaboration server on ws://127.0.0.1:1234 (SQLite in `server/.data/`; env `PORT`, `TYPST_COLLAB_DB`, `TYPST_COLLAB_TOKEN`; GitLab rooms with `TYPST_GITLAB_URL` + `TYPST_GITLAB_TOKEN`, see docs/embedding.md) |
| `mise run server:test` | server tests (vitest, Hocuspocus in-process via `openDirectConnection`, no port) |
| `mise run test:e2e-collab` | starts the server in memory, then the two-user Playwright spec (`tests/e2e/collab.spec.ts`; skipped by `test:e2e`) |
| `mise run server:dev-fake-gitlab` | collaboration server with GitLab rooms against an in-memory fake GitLab (`gitlab:demo/report@<any branch>`) |
| `mise run test:e2e-gitlab` | starts that server, then the GitLab room Playwright spec (`tests/e2e/gitlab.spec.ts`; skipped by `test:e2e`) |
| `mise run quality` / `quality:report` | complexity gate and hot-spot table (see `.claude/skills/code-quality`) |

**Version pins** are all exact:
- Typst 0.15.1: the Rust crates and the CLI in `mise.toml`.
- wasm-bindgen 0.2.129: the crate and the CLI must match.
- binaryen (wasm-opt) 133.
- Rust 1.99.0, Node 24.21.0, pnpm 10.34.6.
- Yjs 13.6.33, y-protocols 1.0.7, Hocuspocus (server, provider, extension-sqlite) 4.7.0,
  node-diff3 3.2.1 (server).

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
- **Snippets are cut from the compiled pages**, so they only appear after a successful compile,
  show only what lies on the first page the range draws on, and include whatever overlaps that
  rectangle (e.g. a float). Every raw box asks again after every compile (one `boxes` walk each),
  also while the Visual view is hidden. Tables with merged cells, `table.cell`, header arguments
  or `columns: (..)` stay raw boxes.
- **GitLab rooms:** conflicts are reported (status line), not highlighted in the views yet;
  "Show changes" covers the main file only; an asset changed on both sides keeps the room's
  version and overwrites upstream on save; GitLab-side renames are seen as delete + create; no
  GitLab sign-in yet (the token check is the stub, the author's name comes from the client); the
  room's main file must exist in the repository (else the widget's empty main is committed).
  `{ doc }` mode has no versions.
- **Collaboration:** images and other non-`.typ` files are not shared (outside GitLab rooms). `{ doc }` mode needs the
  widget and the host on the same Yjs instance (`dist/lib` bundles its own Yjs). In `{ doc }`
  mode the host must pass a synced Y.Doc; with `{ url }` an unreachable server leaves the widget
  local. Remote cursors at an empty line are not drawn.
