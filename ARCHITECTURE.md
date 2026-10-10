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
  engine/                   typed TS wrapper around the wasm, default fonts (generated wasm/, fonts/ — gitignored)
  document/                 TypstDocument — the single source of truth
  source-view/              SourceView — CodeMirror 6 editing view
  preview/                  Preview — worker-backed live preview + hit-testing, zoom, page numbers
    engine.worker.ts        hosts the engine off the main thread
    protocol.ts             request/response messages main ↔ worker
    page-list.ts            page placeholders; SVG only for pages near the viewport
    latest-only.ts          "only the newest value" task runner (compiles, cursor reveals)
    geometry.ts, zoom.ts    pure helpers: overlay boxes, visibility, current page, zoom steps
    toolbar.ts              zoom buttons, zoom label, "page n / total"
  visual-view/              VisualView — ProseMirror projection (schema, projection, view)
  editor/                   createTypstEditor() — composes the widget, Visual/Source tabs, status bar, scoped CSS
  element/                  <typst-editor> custom element (shadow DOM) around createTypstEditor
  index.ts                  public API of the package; registers <typst-editor>
demo/                       dev/demo page (vite root)
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
.text
.change(changes: {from, to, insert}[], origin)   // all in pre-change coordinates (CodeMirror ChangeSet semantics)
.onChange((changes, origin) => …) → unsubscribe
```

- **Single source of truth.** Every view writes through `change()` and reads through `onChange()`.
- **Echo suppression by origin.** A view passes itself as `origin` and ignores notifications whose
  origin is itself.
- **Hidden:** how the text is stored. It is a string today. For collaboration it becomes a `Y.Text`
  wrapper, and the interface stays the same: remote edits arrive with a "remote" origin.

### `SourceView` (`src/source-view`)

```ts
new SourceView(parent, document, { onCursor? })
.reveal(from, to)    // select, scroll to center, highlight
.setDiagnostics([{severity, message, hints, from, to}])   // underline + hover; replaces previous
.destroy()
```

- **Hidden:** CodeMirror and its extensions, and the Typst language support
  (`codemirror-lang-typst/lezer`: a pure-JS Lezer parser using typst-syntax node names, plus
  completion and folding; its Lezer syntax linter is left out so that compiler diagnostics are the
  only error source). Also hidden: `@codemirror/lint`, which maps shown diagnostics through later
  edits. Also hidden: translating ChangeSets to and from `TextChange[]`, and the
  annotation that stops document-originated transactions from being written back.

### `Preview` (`src/preview`)

```ts
new Preview(container, { onJump?, onDiagnostics? })   // renders a toolbar + scrolling page area into container
.update(files: Record<path, text>, main)    // cheap per keystroke
.reveal(path, offset)                        // cheap per cursor move: flash, scroll only if off-screen
.destroy()
```

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
- **Coordinates:** the SVG is scaled to the page element's width (zoom). Clicks are converted with
  `pt = (clientX − pageRect.left) × page.width / pageRect.width`.

### Diagnostics in the widget (`src/editor`)

`summarizeDiagnostics(diagnostics, main)` (pure, unit-tested) splits a compile's diagnostics into
those of the main file (sent to `SourceView.setDiagnostics`) and those elsewhere (other files or
no location: only listed), and computes the status label ("✓ compiled" / "1 error, 2 warnings")
and the jump target (earliest error in the main file, else earliest warning).
`DiagnosticsStatus` renders it as a status bar below both panes; clicking the label reveals the
target in the source.

### `typst-engine` (Rust crate + `src/engine`)

```ts
createEngine(wasm, fonts?: (Uint8Array | Promise<Uint8Array>)[]) → Promise<Engine>
defaultFonts() → Promise<Uint8Array>[]          // src/engine/default-fonts.ts: fetches the bundled font assets
.addFont(bytes)                                  // throws if bytes contain no font face
.setSource(path, text) / .setBinary(path, bytes) / .remove(path)
.compile(main) → { pages: [{hash, width, height, svg}], diagnostics: [{severity, message, hints, path, from, to}] }
.jumpFromClick(page, x, y) → {kind:'source', path, offset, from, to} | {kind:'url'} | {kind:'position'} | null
.jumpFromCursor(path, offset) → [{page, x, y}]
```

Boundary conventions. Each one is decided once, inside the engine:

| Concern | Convention | Why |
|---|---|---|
| Offsets | **UTF-16 code units** | CodeMirror and ProseMirror use them. Typst's UTF-8 byte offsets never leave Rust (`Lines::byte_to_utf16`). |
| Pages | 0-based | JS arrays |
| Coordinates | pt from the page's top-left | the same unit as the page size |
| Results | JSON strings | no serde/JS glue; the TS wrapper parses and types them |
| Paths | absolute project paths (`/main.typ`) | map 1:1 to `FileId` with `VirtualRoot::Project` |

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
- **SVG cache:** page SVGs are keyed by `hash128(&page.frame)`. Unchanged pages skip `typst_svg::svg`.
- **Hit-testing:** `typst_ide::jump_from_click(world, document, PagedPosition)` walks the frames of
  the last successful document. `source_jump` widens the resulting byte offset to the enclosing
  syntax leaf (`LinkedNode::leaf_at`) for highlighting. `jump_from_cursor` is the reverse.

### `createTypstEditor` / `<typst-editor>` (`src/editor`, `src/element`)

```ts
createTypstEditor(host, { source, onChange? }) → { source (get/set), destroy() }
<typst-editor value="…">inline source</typst-editor>   .value (get/set), 'change' event {detail:{value}}
```

- Setting `source`/`value` applies **one minimal edit**: only the range between the common prefix
  and the common suffix changes (`minimalChange`), so cursors and undo history are preserved.
- **Styles** go into `host.getRootNode()`: `document.head`, or the element's shadow root.
  CodeMirror mounts its own styles into the same root. Embedding guide: [docs/embedding.md](docs/embedding.md).

### Worker protocol (`src/preview/protocol.ts`)

```
main → worker   {type:'init', wasm}  (first, once; the URL is resolved on the main thread)
main → worker   {id, type:'compile', files, main} | {id, type:'click', page, x, y} | {id, type:'cursor', path, offset}
worker → main   {id, type:'compile', result} | {id, type:'click', jump} | {id, type:'cursor', positions} | {id, type:'error', message}
```

- Requests are answered in order, because the worker is single-threaded.
- `compile` sends the full file map. The worker diffs paths against the previous call to remove
  files that were deleted, and Typst diffs the text itself.

### `VisualView` (`src/visual-view`)

```ts
new VisualView(parent, document)
.reveal(from, to)    // select the top-level block containing `from`
.destroy()
```

The interesting part is `projection.ts`, which exports two functions plus two sync helpers:

```
 text ──typstParser (Lezer)──► CST ──project()──► PM doc   (blocks carry attrs.src / attrs.sep)
                                                    │ user edit (PM transaction)
 text ◄── minimal TextChange ◄── diff ◄── print() ◄─┘   (untouched nodes print attrs.src verbatim)

 text changed elsewhere ──► project() ──► syncBlocks(): replace only differing top-level blocks
```

- **Schema** (`schema.ts`):
  - Blocks: `paragraph`, `heading`, `bullet_list` / `ordered_list` > `list_item`
    (marker attribute), `raw_block`.
  - Inline: text with `strong` / `emph` marks, `soft_break` (a source newline that renders as a
    space), `hard_break` (`\`), `raw_inline`.
  - The `source` mark remembers how escapes and shorthands (`\*`, `--`) were written.
- **Segmentation:** headings and list items are blocks of their own. Every other run up to a
  `Parbreak` becomes a paragraph if it contains prose (Text, Strong, Emph, …). Otherwise it becomes a
  `raw_block` (`#set`, `#let`, display math, figures, …). A list item with nested content keeps its
  body as a `raw_block`.
- **Separators:**
  - The whitespace between siblings is `attrs.sep`, so it is part of node equality.
  - The last child has no separator; its container owns that whitespace (`list.sep`,
    `doc.lead` / `doc.trail`).
  - Nodes created in the editor have `sep: null` and get a default separator: `\n\n` between
    blocks, `\n` between list items.
- **Pristine tracking:** a module-private `WeakSet` holds the nodes created by `project()`.
  ProseMirror keeps the identity of unchanged nodes, so membership means "still equal to
  `attrs.src`". Pristine nodes print `src`. Edited nodes are printed canonically:
  - Text is escaped (`*`, `#`, `$`, `//`, …, plus line-start markers).
  - Marks are printed as `*x*` / `_x_`, or as `#strong[x]` when the span touches a word character
    or whitespace.
- **Write-back:** `print(doc)` is diffed against the current text (common prefix/suffix), which
  gives exactly one minimal `TextChange`.
- **Read-back:** re-project, then `syncBlocks`. Comparing nodes with `eq` (which includes `src` and
  `sep`) is exact, so the replaced blocks are fresh and pristine.
- **Invariant (unit-tested):** `print(project(src)) === src` for every fixture, and edits change
  only their block.

## Planned modules

### Collaboration

`TypstDocument` is backed by `Y.Text`, with Hocuspocus as the server and GitLab as persistence
(see the concept doc §6).

## Build and test

| Task | What it does |
|---|---|
| `mise run build:engine` | `cargo build --target wasm32-unknown-unknown --release` + `wasm-bindgen --target web` + `wasm-opt -Oz --strip-debug` → `src/engine/wasm/`, prints raw/gzip/brotli size (skipped when the Rust sources are unchanged) |
| `mise run build:fonts` | default fonts from the pinned typst-assets crate → `src/engine/fonts/` |
| `mise run dev` | Vite dev server for `demo/` on 127.0.0.1:5199 |
| `mise run build` | engine + typecheck + static demo build → `dist/demo` |
| `mise run build:lib` | library build → `dist/lib`: bundled ESM, worker, wasm, d.ts (`vite.lib.config.ts`, `tsconfig.lib.json`) |
| `mise run test:unit` | vitest (node): engine against the real wasm, document model, (later) projection round-trips |
| `mise run test:e2e` | builds demo + lib, then Playwright against `dist/demo` and `examples/` (+ `dist/lib`), served through request interception (no port needed) |
| `mise run quality` / `quality:report` | complexity gate and hot-spot table (see `.claude/skills/code-quality`) |

**Version pins** are all exact:
- Typst 0.15.1: the Rust crates and the CLI in `mise.toml`.
- wasm-bindgen 0.2.129: the crate and the CLI must match.
- binaryen (wasm-opt) 133.
- Rust 1.99.0, Node 24.21.0, pnpm 10.34.6.

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
- **Single file only.** Multi-file projects, images and `@preview` packages need `setBinary` wiring
  and a package fetcher.
- **No error display in the visual view** yet (diagnostics only reach the source view).
