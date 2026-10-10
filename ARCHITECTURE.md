# Architecture

This is the technical companion to the product concept in
[docs/2026_10_10_concept.md](docs/2026_10_10_concept.md). It describes the code as it is. When the
code changes, update this file in the same commit.

## Repository layout

```
crates/typst-engine/        Rust → wasm: Typst compiler, SVG export, click/cursor jumps
  src/world.rs              in-memory Typst World (files pushed from JS, embedded fonts)
  src/lib.rs                wasm-bindgen interface (JSON in/out, UTF-16 offsets)
src/
  engine/                   typed TS wrapper around the wasm (+ generated wasm/ — gitignored)
  document/                 TypstDocument — the single source of truth
  source-view/              SourceView — CodeMirror 6 editing view
  preview/                  Preview — worker-backed live preview + hit-testing
    engine.worker.ts        hosts the engine off the main thread
    protocol.ts             request/response messages main ↔ worker
  editor/                   createTypstEditor() — composes the widget, scoped CSS
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
.destroy()
```

- **Hidden:** CodeMirror and its extensions, and the Typst language support
  (`codemirror-lang-typst/lezer`: a pure-JS Lezer parser using typst-syntax node names, plus
  completion and folding). Also hidden: translating ChangeSets to and from `TextChange[]`, and the
  annotation that stops document-originated transactions from being written back.

### `Preview` (`src/preview`)

```ts
new Preview(container, { onJump?, onDiagnostics? })
.update(files: Record<path, text>, main)    // cheap per keystroke
.reveal(path, offset)                        // scroll + flash
.destroy()
```

- **Coalescing:** at most one compilation is in flight. Updates that arrive meanwhile replace each
  other, so only the newest gets compiled. Typing never queues a backlog.
- **Incremental DOM:** every page carries its content `hash`. Only pages whose hash changed get new
  SVG markup. An edit on page 7 does not touch pages 1–6 in the DOM.
- **Errors keep the last good pages.** When a compilation fails, the preview keeps showing the
  previous pages and reports diagnostics through `onDiagnostics`.
- **Coordinates:** the SVG is scaled to the pane width. Clicks are converted with
  `pt = (clientX − pageRect.left) × page.width / pageRect.width`.

### `typst-engine` (Rust crate + `src/engine`)

```ts
createEngine(wasm) → Engine
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
  Typst reparses incrementally and the spans of unchanged nodes stay stable. Fonts are
  `typst-assets`, embedded for now. `today()` returns `None`, which keeps output deterministic.
- **Incremental compilation** comes from Typst's own memoisation (`comemo`), which persists across
  `compile` calls because the world lives as long as the engine.
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

## Planned modules

### `VisualView` (ProseMirror projection)

```
 TypstDocument.text ──parse (Lezer)──► CST ──project──► PM doc  (nodes carry source ranges)
                                                          │
          ◄── minimal TextChange ◄── diff ◄── re-print changed block only ◄── PM transaction
```

- **Supported nodes:** paragraph, heading, strong, emph, lists, link, inline raw, math (atom).
- **Everything else** becomes a `raw_block` / `raw_inline` atom holding the verbatim source.
- **Invariant, checked by tests:** `print(project(src)) === src` for every fixture. An edit changes
  only the text range of the block that was edited.

### Collaboration

`TypstDocument` is backed by `Y.Text`, with Hocuspocus as the server and GitLab as persistence
(see the concept doc §6).

## Build and test

| Task | What it does |
|---|---|
| `mise run build:engine` | `cargo build --target wasm32-unknown-unknown --release` + `wasm-bindgen --target web` → `src/engine/wasm/` (skipped when the Rust sources are unchanged) |
| `mise run dev` | Vite dev server for `demo/` on 127.0.0.1:5199 |
| `mise run build` | engine + typecheck + static demo build → `dist/demo` |
| `mise run build:lib` | library build → `dist/lib`: bundled ESM, worker, wasm, d.ts (`vite.lib.config.ts`, `tsconfig.lib.json`) |
| `mise run test:unit` | vitest (node): engine against the real wasm, document model, (later) projection round-trips |
| `mise run test:e2e` | builds demo + lib, then Playwright against `dist/demo` and `examples/` (+ `dist/lib`), served through request interception (no port needed) |
| `mise run quality` / `quality:report` | complexity gate and hot-spot table (see `.claude/skills/code-quality`) |

**Version pins** are all exact:
- Typst 0.15.1: the Rust crates and the CLI in `mise.toml`.
- wasm-bindgen 0.2.129: the crate and the CLI must match.
- Rust 1.99.0, Node 24.21.0, pnpm 10.34.6.

## Known limitations / next steps

- **wasm is 41 MB,** mostly embedded fonts. Plan: serve the fonts as separate assets, fetch them
  lazily, add `wasm-opt`.
- **Single file only.** Multi-file projects, images and `@preview` packages need `setBinary` wiring
  and a package fetcher.
- **No diagnostics UI yet.** `onDiagnostics` exists, but nothing renders it.
