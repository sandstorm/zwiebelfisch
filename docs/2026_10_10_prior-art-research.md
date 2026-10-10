# Prior art research: Typst source + WYSIWYG editor widget

_2026-10-10 — four parallel research agents (typst.ts, tinymist, collaboration/editors, WYSIWYG-over-text). Raw findings, lightly edited; the decisions drawn from them are in [2026_10_10_concept.md](2026_10_10_concept.md)._

## Part 1 — typst.ts: browser compile, rendering, source mapping, AST

The repo was read at HEAD `9739d81` (2026-10-08). Packages are at `0.8.0-rc3` and pinned to Typst 0.15.1. On npm, the `latest` tag is still `0.7.0` (Typst 0.14.2) and the `rc` tag is `0.8.0-rc3`, so we should pin `@rc` to get Typst 0.15. All paths below are relative to https://github.com/Myriad-Dreamin/typst.ts.

### Short answer

1. **Compiling and rendering:** typst.ts handles this well. There is a WASM compiler with an in-memory VFS, fonts, a package registry and an incremental "vector" delta format. A separate renderer turns that into SVG, canvas or DOM, with incremental patching.
2. **Preview click to source:** the stock npm builds cannot do this today. The plumbing is mostly gone or unused:
   - The SVG backend can emit `data-span="<hex>"` (`crates/conversion/vec2svg/src/backend/mod.rs:559`, `attach_debug_info`). Nothing in the VM calls it any more (`crates/reflexo/src/vector/vm.rs:66` only has an empty default), so no `data-span` attributes are produced.
   - `RenderSession.getSourceLoc(path: Uint32Array)` (`packages/typst.ts/src/renderer.mts:169`, which calls `crates/reflexo/src/vector/incr.rs:97 source_span`) returns `None` when `page_source_mapping` is empty. No producer of `SourceMappingNode` exists in the current crates, so it effectively always returns nothing.
   - Even when a span id is available, turning it into a file range needs the Typst `World`: `world.source(span.id()).find(span).range()`. The web compiler exposes no function for that.
3. **Source cursor to preview position:** same situation. This needs `jump_from_cursor` over the compiled document, and it is not exposed to JS.
4. **AST:** not usefully exposed. `getAst()` returns an ANSI-to-HTML text dump (behind the `ast` feature). The parser package (`@myriaddreamin/typst-ts-parser`) only provides semantic tokens.

**Recommendation:** build our own small Rust/wasm-bindgen crate that reuses `reflexo-typst` and `typst-ide`, following tinymist's approach (details at the end). Use typst.ts only for the renderer and the JS glue.

### Packages

| npm | Purpose |
|---|---|
| `@myriaddreamin/typst.ts` | TS wrapper: `createTypstCompiler`, `createTypstRenderer`, a `$typst` snippet API, `contrib/dom` |
| `@myriaddreamin/typst-ts-web-compiler` | WASM compiler (`packages/compiler/src/lib.rs`) |
| `@myriaddreamin/typst-ts-renderer` | WASM renderer (`packages/renderer/src/*`): vector to SVG, canvas or DOM |
| `@myriaddreamin/typst-ts-parser` | Semantic tokens only (`packages/parser/src/lib.rs`) |
| `@myriaddreamin/typst-all-in-one.ts` | Bundle with the WASM inlined, for a quick start |
| `tinymist-web` | The whole tinymist LSP in WASM (`crates/tinymist/src/web.rs`). The repo is at 0.15.8, but npm only has 0.12.18 |

### Compiler API (`packages/typst.ts/src/compiler.mts`)

```ts
import { createTypstCompiler, FetchPackageRegistry, MemoryAccessModel,
         withPackageRegistry, withAccessModel, loadFonts } from '@myriaddreamin/typst.ts';
const cc = createTypstCompiler();
const am = new MemoryAccessModel();
await cc.init({
  getModule: () => wasmUrlOrBytes,          // typst_ts_web_compiler_bg.wasm
  beforeBuild: [
    loadFonts([...fontUrlsOrBuffers]),      // or preloadRemoteFonts / disableDefaultFontAssets()
    withAccessModel(am),
    withPackageRegistry(new FetchPackageRegistry(am)),
  ],
});
cc.addSource('/main.typ', text);            // wasm: add_source(path, content)
cc.mapShadow('/img.png', bytes);            // binary assets; unmapShadow / resetShadow
const { result, diagnostics } = await cc.compile({ mainFilePath: '/main.typ', format: 'vector', diagnostics: 'full' }); // or 'pdf'
await cc.withIncrementalServer(async srv => {
  const delta = await cc.compile({ mainFilePath: '/main.typ', incrementalServer: srv, diagnostics: 'full' });
});
cc.query({ mainFilePath, selector: '<label>', field: 'value' });   // metadata/query
cc.runWithWorld(opts, async w => w.title());
```

- **Wasm entry points** (`packages/compiler/src/lib.rs`):
  - Setup and files: `reset`, `set_fonts`, `set_inputs`, `add_source`, `map_shadow`, `get_loaded_fonts`.
  - Analysis: `get_ast`, `get_semantic_tokens`, `query`.
  - Compiling: `snapshot` returns a `TypstCompileWorld`, which has `compile(kind)` (0 = paged, 1 = HTML), `get_artifact`, `incr_compile` and `set_pdf_opts`. `create_incr_server` returns an `IncrServer` (`incr.rs`), which has `set_attach_debug_info`.
- **Incremental compilation:** comemo memoisation persists inside the long-lived compiler, so calling `addSource` again and recompiling is cheap. `incr_compile` returns a delta of the vector IR (`IncrServer.update(doc)`). `IncrementalServer.current()` gives the full current state, and `reset()` clears it.
- **Packages** (`packages/typst.ts/src/fs/package.mts`):
  - `FetchPackageRegistry` resolves `@preview/*` to `https://packages.typst.org/preview/{name}-{version}.tar.gz`. It downloads with a **synchronous XHR** (`overrideMimeType('text/plain; charset=x-user-defined')`), untars into `/@memory/fetch/packages/...` and caches the result.
  - Because the XHR is synchronous, run the compiler in a **Web Worker**. To use a GitLab/server-hosted mirror or a private namespace, subclass it and override `resolvePath` and `resolve`.
- **Worker:** there is no ready-made worker wrapper in typst.ts. Use your own Comlink-style `postMessage` around the compiler. Send `Uint8Array` deltas to the main thread as transferables, where the renderer lives.
  - `@vedivad/codemirror-typst` (npm 0.18.8, https://github.com/vedivad/typst-web) is a CM6 extension that runs typst.ts in a worker with incremental diagnostics. It is worth reading as prior art.

### Renderer and incremental rendering (`packages/typst.ts/src/renderer.mts`)

```ts
const r = createTypstRenderer(); await r.init({ getModule: () => rendererWasm });
await r.runWithSession(async s => {
  s.manipulateData({ action: 'reset', data: fullVector });  // the first time
  s.manipulateData({ action: 'merge', data: delta });       // incremental updates
  await r.renderToSvg({ renderSession: s, container: el }); // or s.renderSvgDiff(), renderCanvas, renderDom
});
```

- **Session state:** `RenderSession` exposes `retrievePagesInfo()` (page offsets and sizes in pt), `docWidth` and `docHeight`, and `hitCanvasPageBound`.
- **SVG output:**
  - Glyphs are deduplicated as `<use>` elements.
  - Groups carry `data-tid` (content hash). That makes DOM diff/patching cheap, which is what tinymist's `tools/typst-dom/src/typst-patch.mts` does.
  - Text is overlaid in `.tsel` elements so it can be selected.
- **DOM mode:** `renderDom` (`contrib/dom/typst-doc.mts`) has a `sourceMapping?: boolean` option, which is a legacy hook.
- **Rendering crates:** `crates/conversion/{vec2svg,vec2canvas,vec2dom,vec2bbox}`.

### Source mapping: how tinymist actually does it

tinymist's preview (`crates/typst-preview`, frontend in `tools/typst-dom`) **no longer uses `data-span`**. It uses coordinate hit-testing on the server, which has the World.

1. **Click to source** (`tools/typst-dom/src/typst-debug-info.mts:150-197`):
   - The client finds the page `<g>` from the click target, reads `data-page-number`, `data-page-width` and `data-page-height`, and converts the click to page-local points.
   - It sends `src-point {"page_no","x","y"}`.
   - The server (`crates/tinymist/src/tool/preview/compile.rs:138 resolve_frame_loc`) calls `jump_from_click(world, &page.frame, Point)` (`crates/tinymist-query/src/jump.rs:19`).
   - `jump_from_click` walks `FrameItem::{Group,Text,Shape,Image}` in reverse. For text it checks each glyph's rectangle and uses `glyph.span = (Span, u16 offset)`. It resolves with `world.source(span.id()).find(span)`, and has a half-glyph rule for picking the caret side.
   - The result is turned into a file, line and column by `resolve_span` (`compile.rs:179`): `source.find(span)?.range()` plus the offset, then `source.lines().byte_to_line()`.
2. **Cursor to preview:** `jump_from_cursor(document, &source, cursor)` (`jump.rs:98`):
   - Takes the `LinkedNode` leaf at the cursor, which only works for `Text` and `MathText` nodes.
   - Searches the frames for glyphs with that span.
   - Returns `Vec<Position{page, point}>`, which the client scrolls to and highlights.
3. **Outline:** `srclocation <spanhex>` goes through a `SpanInterner` (`crates/typst-preview/src/actor/editor.rs:276`). The hex ids are interned strings, not raw spans.

Upstream Typst also has `typst_ide::jump_from_click` and `jump_from_cursor`, which do the same thing and are simpler to depend on.

### Plan for our widget

Write a crate `typst-widget-wasm` (wasm-bindgen) on top of `reflexo-typst` (as in `packages/compiler/src/lib.rs`, with a `TypstSystemUniverse`/browser VFS and `reflexo-vec2svg`/`typst2vec` `IncrDocServer`) plus `typst-ide`:

- `update(path, text)`, which rebuilds incrementally and returns `{delta: Uint8Array, diagnostics}`.
- `click(page, x_pt, y_pt) -> {path, start, end}` (UTF-16 offsets for CodeMirror), using `typst_ide::jump_from_click` on the retained `PagedDocument`.
- `cursor(path, offset) -> [{page, x, y}]`, using `jump_from_cursor`.
- `ast(path) -> JSON`, explained in the next section.
- Optionally `element_rects(span)` to highlight in the preview, built from frame traversal: a span gives a list of bounding boxes.

On the JS side, keep `@myriaddreamin/typst-ts-renderer` with its `merge` deltas. That keeps hit-testing in the worker and avoids `data-span` entirely.

**Version alignment:** our crate has to depend on the exact `reflexo-*` versions the renderer expects, because the vector IR is rkyv-serialised. Pin to typst.ts tag `v0.8.0-rc3` and its patched Typst fork, `[patch] typst = { git = "https://github.com/Myriad-Dreamin/typst.git", tag = "typst.ts/v0.8.1" }` (from the root `Cargo.toml`).

### AST / syntax tree in the browser (for ProseMirror conversion)

- **typst.ts:** `getAst()` is a debug dump (`reflexo_typst::dump_ast`, converted from ANSI to HTML), so it is not machine-readable. The parser package only gives semantic tokens (`get_semantic_tokens_by_string(src, 'utf-16')`, encoded LSP-style as `Uint32Array`).
- **Best option:** export `typst_syntax::parse(&text)` from our own wasm crate. Walk `SyntaxNode` into JSON nodes of the form `{kind: SyntaxKind name, range:[from,to], children}`, or into a flat list where `LinkedNode::offset()` gives absolute ranges.
  - Since `typst-syntax` is pure Rust, the AST can live in the same worker as the compiler (same `Source`).
  - The ProseMirror mapping is then: `Markup` children `Heading`, `Strong`, `Emph`, `ListItem`, `EnumItem`, `Text`, `Space`/`Parbreak` and `Raw` become PM nodes. Everything else (code expressions such as `FuncCall` and `SetRule`, plus `Equation`) becomes opaque `typst_raw` nodes that keep the original source slice. PM edits go back into minimal text edits on the source, which stays the source of truth.
  - `Source::edit(range, text)` reparses incrementally, so span numbering stays stable for unchanged nodes.
- **Lighter alternative for CodeMirror highlighting:** `codemirror-lang-typst` (npm 0.6.0, https://github.com/kxxt/codemirror-lang-typst) wraps Typst's own parser for CM6. I did not check its internals.
- **Not recommended:** `tinymist-web` gives the full LSP in the browser (completion, hover, formatting, and `jump` via its request handlers). It is heavy, and npm lags behind (0.12.18), so building it from the repo is required. Consider it later for completion and hover in CodeMirror.

### Key links

- Compiler wasm: https://github.com/Myriad-Dreamin/typst.ts/blob/main/packages/compiler/src/lib.rs
- TS API: `packages/typst.ts/src/{compiler,renderer,options.init}.mts`, `src/fs/package.mts`
- Span plumbing: `crates/conversion/typst2vec/src/pass/span2vec.rs` (`query_element_paths`, `query`, not wired into the web API), `crates/reflexo/src/vector/incr.rs:97`
- tinymist jumps: https://github.com/Myriad-Dreamin/tinymist/blob/main/crates/tinymist-query/src/jump.rs, `crates/tinymist/src/tool/preview/compile.rs`, `tools/typst-dom/src/typst-debug-info.mts`
- Docs: https://myriad-dreamin.github.io/typst.ts/ (cookery guide: `docs/cookery/guide/all-in-one.typ`, `compilers.typ`, `renderers.typ`)

## Part 2 — tinymist

Sources: shallow clones of `Myriad-Dreamin/tinymist` (v0.15.8, typst 0.15.1), `Myriad-Dreamin/typst.ts` and `kxxt/codemirror-lang-typst`, checked on 2026-10-10.

### 1. How typst-preview is built (`crates/typst-preview`, `tools/typst-preview-frontend`, `tools/typst-dom`)

**The server is three actors that talk over tokio channels** (`crates/typst-preview/src/actor/`):
- `render.rs`, `RenderActor`: it holds a `reflexo_typst2vec::incr::IncrDocServer`. After each compile it calls `pack_delta(&TypstDocument)` and sends the bytes out.
- `webview.rs`, `WebviewActor`: it owns one WebSocket per preview page.
- `editor.rs`, `EditorActor`: it handles the "control plane" to the editor (LSP/VS Code) and keeps a `SpanInterner`, which maps short string ids to `typst::syntax::Span`.

**The data plane is binary WebSocket frames** (`crates/typst-preview/src/protocol.rs`):
- `diff-v1,<payload>` is an incremental vector delta.
- `new,<payload>` is a full document. The client resets its state first, then merges.
- The client merges with `renderer.manipulateData({action:"merge", data})` from `@myriaddreamin/typst-ts-renderer`. Then it calls `renderSvgDiff(...)`, which patches the existing SVG DOM in place (`tools/typst-dom/src/typst-doc.svg.mts`, `typst-patch.svg.mts`). Canvas mode uses `renderCanvas` instead.
- The vector format is typst.ts's flat module of glyphs and items, addressed by content hash (`Fingerprint`). A delta only carries items the client has not seen yet, so an edit sends a few KB instead of whole pages.

**Webview → server messages are text strings** (`webview.rs::run`):
- `current`: request a full re-render.
- `src-point {"page_no":N,"x":pt,"y":pt}`: a click in the preview. This is what drives jump-to-source.
- `srclocation <spanId>`: the older method, which used `data-span` ids.
- `outline-sync,<page> <x> <y>`
- `viewer-window-state {json}`

**Server → webview messages are text-prefixed binary frames:**
- `jump,<page> <x> <y>[,...]`: source → preview jump.
- `viewport,<page> <x> <y>`: scroll sync.
- The frontend handles them in `tools/typst-preview-frontend/src/ws.ts` (around lines 343–360).

**Editor ↔ server messages are a JSON control plane** (`ControlPlaneMessage` / `ControlPlaneResponse` in `editor.rs`):
- From the editor: `changeCursorPosition`, `panelScrollTo` (scroll the preview to a source location), `panelScrollByPosition`, `sourceScrollBySpan`, and `syncMemoryFiles` / `updateMemoryFiles` / `removeMemoryFiles`. The last three push unsaved buffers.
- From the server: `editorScrollTo` (a `DocToSrcJumpInfo` with filepath, start and end as line/column), `compileStatus`, `outline` and `viewerWindowState`.
- Cursor highlighting (`ChangeCursorPosition`) is currently **disabled**. The code logs "experimental cursor indicator feature has been temporarily disabled to improve overall performance". Only scroll and jump work today.

**Click → source works like this:**
1. Frontend (`tools/typst-dom/src/typst-debug-info.mts`, `installEditorJumpToHandler`): from the click target it walks up to the page element, which carries `data-page-number`, `data-page-width` and `data-page-height`. It turns the click into page-relative points and sends `src-point`.
2. Server (`crates/tinymist/src/tool/preview/compile.rs`, `resolve_frame_loc`) calls `tinymist_query::jump::jump_from_click(world, &page.frame, Point)`. That returns a `(SourceSpanOffset, SourceSpanOffset)` span range. Text items give a span plus a glyph offset.
3. `resolve_span` turns that into `source.find(span).range()`, then into line/column, and sends `editorScrollTo`.

**Source → preview:** `resolve_document_position` → `jump_from_cursor(document, source, cursor) -> Vec<Position>` (`crates/tinymist-query/src/jump.rs:98`) → a `jump` frame → the frontend scrolls and flashes the spot.

**What this means for us:** clicks are resolved by **geometry against the server-side `Frame` tree**, not by DOM attributes. typst.ts can also put `data-span="<hex u64>"` on SVG elements: `IncrServer::set_attach_debug_info(true)`, emitted in `crates/conversion/vec2svg/src/backend/mod.rs:561`. Those ids only resolve with the same compiler `World`, via `Source::find(Span)`.

**New experimental frontends:**
- `tools/typst-preview-frontend-ng`: canvas in a worker, with `worker/text-hit.ts` for text hit-testing.
- `crates/tinymist-viewer`: a Vello/WGPU viewer.
- Both use `@myriaddreamin/typst.ts` / `typst-ts-renderer` at `=0.8.0-rc3`. npm `latest` is `0.7.0`; `rc` is `0.8.0-rc3`.

### 2. Can we reuse this in an embeddable browser widget?

**typst-preview is built for a native server.** It needs tokio actors and a WebSocket. We can't drop it into a browser widget as-is. Its protocol is a good template for the "server mode" we need later.

**For an all-in-browser widget:**
- `@myriaddreamin/typst-ts-web-compiler` already exposes `compiler.create_incr_server()` and `incr_compile(...)`, which return the same `diff-v1` delta bytes.
- The renderer consumes them in a Worker with `manipulateData('merge')` and `renderSvgDiff`. The same pipeline runs without a network hop.
- **The typst.ts web compiler has no jump/click-resolution API.** Its exports in `packages/compiler/src/lib.rs` are `add_source`, `map_shadow`, `compile`, `query`, `get_ast`, `get_semantic_tokens`, `snapshot`, `incr_compile` and `set_inputs`. Neither `jump_from_click` nor `jump_from_cursor` is exported.
- **Options:**
  - (a) Build our own small wasm-bindgen crate (typst + `typst-ide`, which has `jump_from_click(world, doc, frame, click) -> Option<Jump>` and `jump_from_cursor(doc, source, cursor) -> Vec<Position>`) and reuse the typst.ts world and fonts.
  - (b) Use `data-span` ids plus a wasm helper that decodes `Span` → file + range through `Source::find`.
  - (c) Use tinymist-web LSP custom commands (see section 3).
- **For our ProseMirror mapping, span → byte range is the key primitive.** It gives preview element → source offset → ProseMirror node, which is option (b).

### 3. The tinymist LSP in the browser (`tinymist-web`)

- The `tinymist` crate builds for the browser with the `web` feature (`crates/tinymist/src/web.rs`, `crates/tinymist/package.json`):
  - npm name: `tinymist-web`
  - build: `wasm-pack build --target web -- --no-default-features --features web,no-content-hint`
- **The JS API** is `initSync(wasmUrl)` plus `new TinymistLanguageServer({sendEvent, sendRequest, sendNotification})` (fields come from `sync-lsp/src/server.rs::JsTransportSender`). Its methods are `on_request(method, params) -> value | Promise`, `on_notification`, `on_response`, `on_event(id)` and `TinymistLanguageServer.version()`.
- **Reference wiring:** `editors/vscode/src/web/server.ts` runs it in a Web Worker with `vscode-languageserver/browser` (`BrowserMessageReader` and `BrowserMessageWriter` on `self`). It queues events and drains them after each response through the `h()` helper.
- **Status:** "Added browser support for running the tinymist language server" landed in [PR #1944](https://github.com/Myriad-Dreamin/tinymist/pull/1944), listed in the CHANGELOG (search result says v0.14.12, March 2026).
- **Caveat: the npm package is stale.** `tinymist-web` on npm has only `0.12.18` (January 2025). Current source is 0.15.8. **Plan to build it from source and vendor it** (Rust toolchain 1.92 plus wasm-pack).
- **Second caveat:** tinymist pins a **fork of typst** (`[patch]` git tags at `Myriad-Dreamin/typst`, Cargo.toml:327+). If we also ship typst.ts we'll load two typst wasm binaries, likely several MB each (sizes not measured). Make sure their typst versions match.
- **CodeMirror bridge:** use an LSP client for CM6. One option is `@codemirror/lsp-client` (Marijn's official one; not checked in this session). Others are `codemirror-languageserver` or a hand-written transport: a `postMessage` Transport to the worker that hosts the bridge above. That gives completion, hover, signature help, diagnostics (`textDocument/publishDiagnostics`), formatting (typstyle) and semantic tokens.
- **Files:** the server needs the files we feed it through `didOpen`/`didChange`. Packages from `@preview/...` need a fetch-capable package registry in web mode, which still needs checking.

### 4. CodeMirror 6 Typst language packages

- **`codemirror-lang-typst`** ([kxxt/codemirror-lang-typst](https://github.com/kxxt/codemirror-lang-typst)) is the only real CM6 package. Version 0.6.0, Apache-2.0, updated 2026-08.
  - `import {typst} from "codemirror-lang-typst"` highlights by compiling the official `typst-syntax` crate to wasm (`build:wasm` uses wasm-pack on `typst/crates/typst-syntax`). It gives a placeholder tree, so no structural features.
  - `import {typst_lezer, typstParser} from "codemirror-lang-typst/lezer"` is a **WASM-free Lezer parser for Typst 0.15**, using node names from `typst-syntax` (`src/parser.ts`, 70 KB, hand-written). It includes folding, indentation, a syntax linter (`lint.ts`), and completion of built-in functions, parameters, symbols (`arrow.r.long`), labels and local `let`s (`complete.ts`, `signatures.ts`, `symbols.ts`). It also handles raw-block nested languages through `codeLanguages`.
  - Peer dependencies: `@codemirror/{autocomplete,language,lint,state,view}`, `@lezer/common`, `@lezer/highlight`.
  - **Recommendation:** use `typst_lezer()` as the base layer. It is instant and fully client-side, and it provides a Lezer tree we can reuse for structure, e.g. a cheap outline. Add tinymist-web LSP for semantic completion and diagnostics.
- **Other options:**
  - `get_semantic_tokens` in typst.ts's web compiler, for semantic highlighting through CM decorations.
  - Typster ([typster-io/typster](https://github.com/typster-io/typster)) paints Shiki's TextMate grammar as CM decorations.
  - [codemirror-treesitter](https://github.com/Eric-Song-Nop/codemirror-treesitter) plus `frozolotl/tree-sitter-typst` / `uben0/tree-sitter-typst` through `web-tree-sitter`. Neither tree-sitter grammar is on npm.
  - No `@codemirror/lang-typst` exists.

### 5. What to take into our design

1. **Preview:** typst.ts incremental vector (`incr_compile` → `manipulateData merge` → `renderSvgDiff`) in a Web Worker. Put the compile + render behind a `diff-v1`/`new` frame abstraction so we can later swap in a server (tinymist-style WebSocket) for collaborative or GitLab mode.
2. **Click → source:** port tinymist's `jump_from_click` (`crates/tinymist-query/src/jump.rs`, Apache-2.0) or `typst-ide::jump_from_click` into a small custom wasm crate built on the same world as the compiler. Send `{page_no, x, y}` the way `typst-debug-info.mts::resolveFrameLoc` computes it. Result: a byte range, which we highlight in CodeMirror with `EditorView.scrollIntoView` plus a `Decoration.mark`, and map to a ProseMirror node through our source-offset table.
3. **Source → preview:** `jump_from_cursor`, then scroll and flash. We'd be building the cursor indicator tinymist has turned off; it needs throttling.
4. **Language intelligence:** `codemirror-lang-typst/lezer` now; `tinymist-web` built from source in a worker (pattern in `editors/vscode/src/web/server.ts`) as phase 2.

### Links

- tinymist: https://github.com/Myriad-Dreamin/tinymist
- PR #1944 (browser LSP): https://github.com/Myriad-Dreamin/tinymist/pull/1944
- VS Code Web issue #970: https://github.com/Myriad-Dreamin/tinymist/issues/970
- typst.ts: https://github.com/Myriad-Dreamin/typst.ts
- codemirror-lang-typst: https://github.com/kxxt/codemirror-lang-typst
- Typster: https://github.com/typster-io/typster
- codemirror-treesitter: https://github.com/Eric-Song-Nop/codemirror-treesitter
- Tree-sitter discussion: https://forum.typst.app/t/how-to-use-tree-sitter-for-syntax-highlighting-in-typst/2432
- Obsidian + tinymist on CM6: https://github.com/wilfriedago/obsidian-tinymist

## Part 3 — Collaboration & existing Typst web editors

### 1. The two repos you named

#### collabst/collabst ([repo](https://github.com/collabst/collabst))
- **License:** AGPL-3.0. About 404 stars. The README says: *"under maintenance and is not currently functional"* while a refactor is underway. Last commit on `main` in the clone was 2026-06-15.
- **Frontend:** SvelteKit 5, CodeMirror 6, `codemirror-lang-typst@^0.4.0` and `codemirror-lang-bib`.
  - Collaboration packages: `yjs@^13.6.27`, `y-codemirror.next@^0.3.5`, `y-websocket@^3`, `y-indexeddb` for an offline cache.
  - `frontend/src/lib/yjs.ts` uses one `Y.Doc` per project, with one `Y.Text` per file (`getFileText(ydoc, fileId)`).
- **Preview:** a Web Worker (`frontend/src/lib/preview/typst-worker.ts`) loads `@myriaddreamin/typst.ts/dist/esm/contrib/all-in-one-lite.bundle.js` from jsDelivr. It calls `typst.setCompilerInitOptions`, `getCompiler()` and `typst.pdf({mainFilePath})`, and paginates SVG in `svgPagination.ts`.
- **Backend:** Python FastAPI.
  - Collaboration server: `pycrdt` + `pycrdt-websocket==0.15.0`.
  - `backend/app/websocket/yjs_server.py` has a custom `RedisYStore(BaseYStore)`. It keeps live updates in Redis and takes periodic snapshots to PostgreSQL. Assets are stored in MinIO.
  - Roles are reader/commentor/editor/admin (`backend/COLLABORATION.md`).
- **Takeaway:** a good reference for "Yjs over a non-Node server with Redis plus Postgres snapshots". It is not usable at the moment.

#### automataIA/wasm-typst-studio-rs ([repo](https://github.com/automataIA/wasm-typst-studio-rs))
- **License:** the README says MIT, but the repo has no LICENSE file, so the license is legally unclear. About 61 stars. Last push 2026-07.
- **Stack:** Rust, Leptos 0.8 (CSR), Trunk and Tauri 2. It uses `typst 0.13`, `typst-ide`, `typst-svg`, `typst-pdf` and `typst-as-lib`, all compiled to WASM.
- **Editor:** a plain `<textarea>` (`src/components/editor.rs`), not CodeMirror. Syntax highlighting is an overlay.
- **Click-to-jump:** `src/compiler/ide.rs::jump()` calls `typst_ide::jump_from_click(&world, document, frame, click)` and moves the caret when the result is `Jump::File(id, cursor)`. This is the canonical approach.
- **No collaboration and no backend.** Data is kept in localStorage and IndexedDB. Packages are fetched from `packages.typst.org` and cached in IndexedDB.
- **Takeaway:** a useful reference for compiling directly against the `typst` crates in WASM and for `jump_from_click`. Not useful as a base for an embeddable JS widget.

### 2. Other open-source Typst web editors

| Project | Stack | Preview | Collaboration | License, maturity |
|---|---|---|---|---|
| [pku-typst/TOSS](https://github.com/pku-typst/TOSS) | React + CM6 + Yjs. Rust/Axum backend using `yrs` and `git2`, PostgreSQL | Persistent browser worker with `@myriaddreamin/typst.ts@0.8.0-rc3` and incremental vector rendering to canvas. Navigation works in both directions | Yjs over WebSocket, with `yrs` on the server and state in Postgres. Has a local git history volume. Imports from and checkpoints to **GitHub/GitLab/Gitea/Forgejo** are explicit actions; normal edits do not commit | AGPL-3.0, 16 stars, active (Sept 2026). The closest match to your long-term server; well worth reading |
| [TeXlyre/texlyre](https://github.com/TeXlyre/texlyre) | React 19 + CM6 (`@codemirror/lsp-client`), `isomorphic-git` | Forks of typst.ts (`@texlyre/typst.ts@0.8.0-rc3`) | Yjs (`y-codemirror.next@=0.3.5`), with **`y-webrtc`** for peer-to-peer and `y-websocket` too. Local-first via `y-indexeddb` | AGPL-3.0, about 970 stars, active. The most mature of these |
| [SirBlobby/TypstDrive](https://github.com/SirBlobby/TypstDrive) | SvelteKit + Bun, Rust/Axum server | **Server-side** compile with the `typst`, `typst-svg` and `typst-render` crates (Typst 0.15.1) | Yjs + `y-codemirror.next`, with `yrs` on the server | Apache-2.0, 12 stars |
| [fl-grtg/typst-editor](https://github.com/fl-grtg/typst-editor) | FastAPI + SQLite | Compiles to PDF in the browser | Realtime collaboration, presence, comments | No clear license, 0 stars |
| [ortic/typst-wysiwyg](https://github.com/ortic/typst-wysiwyg) | TipTap 2.27 (ProseMirror) + typst.ts 0.7 + Tauri | typst.ts in WASM | None | MIT, 16 stars, prototype. **Important:** its source of truth is a JSON model; `.typ` is generated from it, and editor state is stored in a trailing comment. `typimport.ts` keeps unknown constructs verbatim. This is the opposite of your requirement, but its "raw Typst block" UX and ribbon are useful to copy |
| [Overleaf](https://github.com/overleaf/overleaf) (LaTeX) | CM6 + "Visual Editor" (CM6 decorations, not ProseMirror) | Server-side | **OT** (a ShareJS-derived fork) with a central server, plus a git bridge | AGPL. The best prior art for "source of truth is text, rich view on top" |

**typst.app (official):** proprietary. Neither the docs nor any public source say whether its sync uses OT or a CRDT; the docs only promise "real-time synchronization with co-authors" ([docs](https://typst.app/docs/web-app/)). Treat it as unknown. It is a closed central-server SaaS, and self-hosting is a paid offering.

**Pattern across all the open-source projects:** CodeMirror 6, Yjs `Y.Text` per file, typst.ts in a Web Worker, and a server-side Yjs store (Node, `pycrdt` or `yrs`). None of them has a WYSIWYG view whose source of truth is the text. **That is a gap, and it is where your project is new.**

### 3. Recommended realtime architecture

#### CRDT choice: Yjs, with `Y.Text` as the only shared state for documents
- **Yjs `yjs@13.6.33`** (v14 is in prerelease at `14.0.0-8`, so stay on 13 for now) with **`y-codemirror.next@0.3.6`**. Every comparable project uses this pair. It gives remote cursors through `y-protocols/awareness` and per-user undo through `Y.UndoManager`.
- **`prosemirror-collab` 1.3.1 and `@codemirror/collab` 6.1.1:** these are OT-style "step authority" designs. They need a central server that rebases steps, and they assume the ProseMirror *tree* is canonical. That is wrong for you: the shared truth must be the string.
- **Automerge 3.5 (`@automerge/automerge-codemirror` 0.2, `@automerge/prosemirror` 0.2):** works, but the ecosystem is thinner and it has no equivalent of Hocuspocus. Loro (`loro-crdt` 1.16, `loro-codemirror`, `loro-prosemirror`) is promising but young.
- **Do not use `y-prosemirror` to bind the WYSIWYG view.** It syncs a `Y.XmlFragment`, which would create a second source of truth that you then have to reconcile with the string.

#### Binding the ProseMirror view when the truth is `Y.Text`
The text must be authoritative, so the WYSIWYG view is a **local projection**:

```
Y.Text ──(y-codemirror.next)──► CodeMirror 6
   │  observe(delta)
   ▼
typst-syntax parse (WASM: typst-syntax crate, or tinymist's parser) ──► PM doc (local only, never synced)
   ▲                                                                   │ PM transaction
   └──── apply minimal text edits to Y.Text ◄── per-node serializer ───┘
```

1. **Build the PM doc from the syntax tree, not from a full re-parse.**
   - Each PM node carries `srcFrom`/`srcTo` offsets, or better, Yjs `RelativePosition`s (`Y.createRelativePositionFromTypeIndex`).
   - Constructs you can't model become an atom node `raw_typst { src }`. Edit it inline with a nested CodeMirror, which is ProseMirror's documented "embedded code editor" example.
2. **When a PM transaction happens:**
   - Find the changed top-level blocks.
   - Re-serialize *only those blocks*.
   - Write the result as `ytext.delete`/`insert` minimal diffs inside one `ydoc.transact(fn, origin='pm')`, trimming the common prefix and suffix.
   - Untouched source bytes, including formatting and comments, are never rewritten. This is the key to "Typst stays source of truth".
3. **When `Y.Text` changes from CodeMirror or a remote peer (origin ≠ 'pm'):**
   - Incrementally re-parse the affected top-level blocks.
   - Replace the matching PM nodes with a tagged transaction, `setMeta('fromText', true)`, so no echo loop starts.
   - Map the PM selection through the change.
4. **Ready-made bridge:** [`@pm-cm/core` / `@pm-cm/yjs` 0.0.13](https://github.com/MuNeNICK/prosemirror-codemirror-sync) (MIT, early stage) implements this pattern with pluggable `serialize`/`parse` functions.
   - It provides `isBridgeChange()` loop guards, prefix/suffix minimal diffs and `buildCursorMap()` for PM↔CM position mapping.
   - Its Yjs mode also keeps a `Y.XmlFragment`, but "text side wins". Use it as a reference, or fork it and drop the fragment.
   - Marijn's advice is the same: diff-based, line or block-level re-parse rather than mapping steps ([thread](https://discuss.codemirror.net/t/synchronising-codemirror-6-and-prosemirror/7339)).
5. **Remote cursors in WYSIWYG:** the awareness state stores the CM-side `RelativePosition`. Convert it to a PM position with the cursor map and render it as PM decorations.

#### Preview and click-to-source
- **`@myriaddreamin/typst.ts@0.7.0`** (0.8.0-rc3 is used by TOSS and TeXlyre) runs in a worker. Feed it `ytext.toString()`, debounced, and use incremental vector rendering.
- **Click-to-source has two options:**
  - **Span-based:** tinymist's `typst-preview` renderer emits span data on SVG elements, and the click resolves to a source range.
  - **Position-based:** the wasm-typst-studio approach, calling `typst_ide::jump_from_click` with page and point.
- Highlight the resolved range in CodeMirror, and also in ProseMirror through the cursor map.

#### Server: Hocuspocus
- **`@hocuspocus/server@4.7.0` + `@hocuspocus/provider@4.7.0`** (MIT). Compared with plain `y-websocket@3.1` / `@y/websocket-server@0.1.5`, it adds auth hooks (`onAuthenticate`), `onLoadDocument`/`onStoreDocument` with debounce and `maxDebounce`, Redis horizontal scaling (`@hocuspocus/extension-redis`), and webhooks.
- **Alternatives:**
  - `yrs` in Rust, as TOSS and TypstDrive use, if you want a Rust backend that can also compile Typst on the server.
  - `pycrdt-websocket`, as collabst uses.
- **Document layout:** one `Y.Doc` per project, with a `Y.Map<path, Y.Text>` for `.typ`/`.bib` files. Binary assets are stored by reference: a blob store key or GitLab path plus SHA, never inside Yjs.

#### Persisting to GitLab and committing back
Follow the TOSS model: **the workspace (Yjs state) is authoritative while a session is live. Git is a checkpoint, not a per-keystroke sink.**
- **Load (`onLoadDocument`):** if the database has no Yjs state, fetch the files with `GET /projects/:id/repository/tree?ref=…&recursive=true` and `GET /projects/:id/repository/files/:path/raw`. Seed each `Y.Text`. Store the commit SHA as `baseSha` in a `Y.Map('meta')`.
- **Store:** save the Yjs update binary to Postgres or S3 on every debounced `onStoreDocument`.
- **Commit:**
  - Triggers: an explicit "Save version" button, when the last client leaves (`onDisconnect`), or a timer such as 5 minutes idle.
  - Use `POST /projects/:id/repository/commits` with an `actions[]` array (`create`/`update`/`delete`/`move`, `encoding: base64` for binaries) and **`last_commit_id: baseSha`** for optimistic concurrency.
  - Commit authorship comes from awareness or session users. GitLab also supports co-author trailers.
- **Upstream conflicts:**
  - If GitLab rejects the commit because upstream moved, fetch the new upstream and do a 3-way text merge (base = `baseSha` content).
  - Apply the upstream delta to `Y.Text` as minimal edits, so live clients merge it as a CRDT. Then commit again.
  - Alternatively, commit to a branch per session and open an MR. That fits non-technical users ("Publish" = merge).
- Use GitLab webhooks (push events) to trigger the inbound sync while a room is open.

#### Embeddable widget
Ship it as a framework-agnostic ES module or Web Component, e.g. `<typst-editor>`:
- Typst WASM runs in a Worker, and the WASM is lazy-loaded (about 28 MB including fonts).
- The provider (Hocuspocus, `y-indexeddb` or none) is injected, so the same widget works standalone, offline or collaboratively.

Sources: [collabst](https://github.com/collabst/collabst), [wasm-typst-studio-rs](https://github.com/automataIA/wasm-typst-studio-rs), [TOSS](https://github.com/pku-typst/TOSS), [TeXlyre](https://github.com/TeXlyre/texlyre), [TypstDrive](https://github.com/SirBlobby/TypstDrive), [fl-grtg/typst-editor](https://github.com/fl-grtg/typst-editor), [ortic/typst-wysiwyg](https://github.com/ortic/typst-wysiwyg), [Collabst forum post](https://forum.typst.app/t/introducing-collabst-a-self-hosted-collaborative-workspace-for-typst/8856), [Typst web app docs](https://typst.app/docs/web-app/), [prosemirror-codemirror-sync](https://github.com/MuNeNICK/prosemirror-codemirror-sync), [CM6/PM sync thread](https://discuss.codemirror.net/t/synchronising-codemirror-6-and-prosemirror/7339), [y-codemirror.next](https://github.com/yjs/y-codemirror.next), [Yjs ProseMirror binding](https://docs.yjs.dev/ecosystem/editor-bindings/prosemirror). npm versions come from registry.npmjs.org as of 2026-10-10.

## Part 4 — WYSIWYG over a textual source of truth

### TL;DR recommendation

- **Keep the canonical state as plain text.** That means a CodeMirror `Text`, and a `Y.Text` once collaboration arrives. Never make a ProseMirror doc the stored state.
- **Parse it with one lossless concrete syntax tree (CST): `codemirror-lang-typst/lezer`.** It is a pure-JS, incremental Lezer parser that uses the node names from typst-syntax. I tested it and it works (details below).
- **Ship approach B first.** That is the Overleaf-style "visual mode": CodeMirror 6 decorations over the source. It is lossless by construction, has no position mapping problem, and collaboration is just y-codemirror.next.
- **Add approach A as a "projection" for the Word-like view.** Build a ProseMirror doc from the CST. Each PM node stores `{from, to}` source spans and the original source slice. When the user edits in PM, rewrite only the source of the smallest node that changed and send that to the text as a minimal edit. Untouched source stays byte-identical. Anything not modelled becomes an atom node (`raw_block` / `raw_inline`) holding verbatim source, edited in a nested CodeMirror.
- **Avoid parse-everything / re-print-everything** (Milkdown, Quarto, Tiptap markdown). It rewrites the user's formatting, which breaks the "Typst stays source of truth" rule and produces noisy git diffs on GitLab.

### 1. Prior art survey

#### Approach B: rich rendering inside the source editor (CodeMirror 6 decorations)

**Overleaf Visual Editor (LaTeX).** Code is in [overleaf/overleaf `services/web/frontend/js/features/source-editor/extensions/visual/`](https://github.com/overleaf/overleaf/tree/main/services/web/frontend/js/features/source-editor/extensions/visual).
- Parsing uses their own Lezer LaTeX grammar (`source-editor/lezer-latex`).
- `atomic-decorations.ts` builds `Decoration.replace` widgets and also feeds `EditorView.atomicRanges`, so the cursor skips over hidden markup.
- `mark-decorations.ts` styles bold/italic/sections with `Decoration.mark`.
- Each construct has a widget in `visual-widgets/` (`begin.ts`, `math.ts`, `graphics.ts`, `tabular.tsx`, `footnote.ts`, `preamble.ts`, `maketitle.ts`, ...).
- `selection.ts` and `select-decorated-argument.ts` reveal the raw source when the cursor or selection enters a construct.
- `skip-preamble-cursor.ts` hides the preamble as a single widget.
- `paste-html.ts` converts pasted HTML into LaTeX source.
- `table-generator.ts` renders tables as an HTML table widget, and cell edits are written back as text changes.
- Unsupported constructs simply stay visible as source, so nothing is ever lost.

**codemirror-visual-markup** ([TeXlyre/codemirror-visual-markup](https://github.com/TeXlyre/codemirror-visual-markup), npm `codemirror-visual-markup@0.2.0`, MIT, experimental).
- This is the closest existing Typst prior art. It supports LaTeX and Typst, and its README says: "Visual mode decorates the live CodeMirror document instead of maintaining a separate editable DOM tree. The source remains authoritative."
- Files worth reading: `src/view/decorations.ts` (replace/mark decorations plus a `revealRanges` facet), `src/languages/typst/{rules,table,figure}.ts`, `src/ui/dual-editor.ts` (`DualVisualEditor`, which switches between source and visual modes) and `test/collab.test.ts`.
- Weakness: it tokenizes with hand-written regex-ish rules (`src/core/tokenizer.ts`), not a real Typst CST.
- It is used by [TeXlyre](https://github.com/TeXlyre/texlyre), a local-first LaTeX/Typst editor using Yjs and typst.ts.

**Obsidian Live Preview, Zettlr, HyperMD.** All are CodeMirror 6 with markdown decorations. Syntax shows on the line or construct under the cursor and is hidden elsewhere. These show the pattern scales to millions of users.

**Typora (block-hybrid).** Each block keeps its own markdown source. The block under the cursor is shown as source, and other blocks are rendered. This is a useful middle ground: a raw block can switch into source in place.

**B pros**
- 100% lossless.
- Positions are identity (source offset equals editor offset), so click-in-preview to jump to source is trivial.
- Undo/redo, search and LSP-like features (tinymist) all work on the same doc.
- Collaboration via `y-codemirror.next` is proven.
- Arbitrary Typst always works.

**B cons**
- Still "markup with lipstick". Enter in lists, table editing, drag/drop of blocks and multi-paragraph selections behave like a text editor, not like Word.
- Non-technical users do see `#`, `*` and `[` when the cursor enters a construct.
- CodeMirror is line-oriented, so block widgets such as tables need nested editors (Overleaf built a lot of custom machinery for this).

#### Approach A: parse into a ProseMirror doc and serialize back

| Project | How it works | Fidelity |
|---|---|---|
| **Quarto / RStudio visual editor** ("panmirror") | ProseMirror ↔ Pandoc AST. Every save re-writes the markdown via Pandoc. Has a `canonical: true` mode and writer options (`wrap: 72`, `references.location`). Unknown TeX/HTML becomes raw blocks (```` ```{=tex} ````). | Lossy normalization: always `*x*` instead of `_x_`, escapes syntax characters, inline footnotes turn into numbered footnotes ([docs](https://quarto.org/docs/visual-editor/markdown.html)). Their workaround was to make source mode emit the same canonical form. |
| **Milkdown** (`@milkdown/kit@7.22`) | remark mdast ↔ PM. Every change goes through `remark-stringify`. | Normalizes formatting. Not lossless. |
| **Tiptap** (`@tiptap/markdown@3.31`) and `prosemirror-markdown@1.13` | Tokenizer (`marked` or `markdown-it`) → PM; `MarkdownSerializer` re-prints everything. | Lossy. Projects such as [docmost PR #2540](https://github.com/docmost/docmost/pull/2540) add round-trip-only attributes to get closer. |
| **Curvenote / MyST** (`@curvenote/schema`, `myst-to-prosemirror`) | PM schema with `fromMarkdown` / `toMarkdown` / `toTex`. | Re-serializes. Not lossless. |
| **[ortic/typst-wysiwyg](https://github.com/ortic/typst-wysiwyg)** | Tiptap 2.27 plus typst.ts 0.7. `src/typimport.ts` (914 lines) is a hand-written scanner that turns `.typ` into a PM JSON model. Unknown constructs, imports and preamble become verbatim `rawBlock`s. `src/serialize.ts` regenerates the whole `.typ` and **embeds editor state as base64 in a trailing comment** (`STATE_MARKER`). | The Typst file is effectively output, not source of truth. It does have a good UX reference: Word-style ribbon, `#set`/`#let`/`#show` editors, a slash menu and footnote popovers. Also see `roundtrip.test.ts` and `fidelity.test.ts`. |
| **TyX** ([tyx-editor/TyX](https://github.com/tyx-editor/TyX)) | Lexical with its own JSON format; exports Typst. | Typst is an export target only. |
| **dereklei12/Typst-Editor** | Tiptap → Typst. | Export only. |

**A pros**
- Real WYSIWYG semantics: block structure, Word-like Enter and Backspace, tables (`prosemirror-tables`), drag handles, paste from Word/HTML, and input rules.
- This is what non-technical users expect when coming from OnlyOffice.

**A cons**
- Round-tripping is the hard problem. Every project above that re-prints the whole document loses formatting.
- Position mapping between PM positions and source offsets has to be maintained by hand.
- Collaborating on `y-prosemirror` would make the PM doc the source of truth, which contradicts the requirement.

#### How these handle unsupported constructs (opaque nodes)

- **Quarto:** raw blocks and raw inline (`{=tex}`).
- **typst-wysiwyg:** a `rawBlock` node containing the source text.
- **Overleaf:** leaves the source visible.

For Typst, use the following:
- `raw_block` (atom, `attrs.src`) for top-level `#let`, `#set`, `#show`, `#import` and unknown code blocks.
- `raw_inline` (atom) for unknown inline `#expr` and code.
- A NodeView that renders the compiled SVG snippet, or a code chip, and opens a nested CodeMirror on double-click. This is the [ProseMirror "embedded CodeMirror" example](https://prosemirror.net/examples/codemirror/) pattern.

### 2. Recommended Typst design: a source-anchored ProseMirror projection

1. **Canonical state.** `Y.Text` (later) or a CodeMirror `Text`. The CodeMirror view binds directly.
2. **Parse.** Use the Lezer `typstParser` with incremental `TreeFragment`s.
3. **Project (text → PM).** Walk the CST.
   - Supported nodes map to PM nodes: `Heading`, `Strong`, `Emph`, `ListItem`/`EnumItem`, `Parbreak`, `Equation` (as a math atom), `Raw`, `Link`, `Ref`/`Label`, `FuncCall` for whitelisted functions (`emph`, `strong`, `table`, `figure`, `image`, `footnote`, `highlight`, `text(fill:)`), and `#set`/`#show`/`#let` (as a style panel or atom).
   - Everything else becomes a raw atom with `src`.
   - Each node stores `attrs.span = [from, to]` and `attrs.src` (the original slice).
4. **Write back (PM → text).** On each PM transaction, find the changed top-level blocks with `ReplaceStep` ranges and `doc.content.findDiffStart/End`. For each one, re-print only that block.
   - The printer reuses `attrs.src` for any child node that was not modified (equal by node identity or `node.eq`). Only freshly created or edited nodes get canonical Typst printing.
   - Compute a character diff between the old slice and the new slice (`diff-match-patch` or a simple common prefix/suffix) and dispatch the minimal `{from, to, insert}` to the text.
   - This is "lossless for untouched regions, canonical only for what you touched". It is the property the markdown editors lack.
5. **Read back (text → PM).** For remote edits or edits in the CodeMirror pane: re-parse incrementally, rebuild only the affected top-level blocks, and replace them in PM with one transaction. Map the PM selection through it. Keep a guard flag so the two sync directions do not feed each other in a loop.
6. **Position map.** Source offsets come from `attrs.span` plus the text offset inside the node, which handles preview click → PM node. For the preview itself use typst.ts / tinymist (typst-ide `jump_from_click`, which returns a source span) and map span → offset → CodeMirror selection and PM `NodeSelection`.
7. **Collaboration.** Use only `Y.Text` + `y-codemirror.next` (and Yjs awareness). PM never syncs directly; it is a view derived from the text. For long-term GitLab use, Hocuspocus (`@hocuspocus/server`) persists the Y doc and commits `.typ` files through the GitLab API.

**Phasing:**
- **(1)** CodeMirror source pane with `codemirror-lang-typst` and a typst.ts preview with click-to-source.
- **(2)** Light approach-B decorations, borrowing from codemirror-visual-markup.
- **(3)** The PM projection for paragraphs, headings, lists, marks and raw atoms. Then tables, figures, images and footnotes.

Round-trip tests: for each fixture, `print(parse(src)) === src`. Then randomized edit tests that check only the touched span changes.

### 3. Typst parsing in JS (the key enabler)

- **`codemirror-lang-typst@0.6.0`** ([kxxt/codemirror-lang-typst](https://github.com/kxxt/codemirror-lang-typst), Apache-2.0). This is the best option.
  - It has two entry points: `typst()`, which highlights via the real **typst-syntax crate compiled to WASM** (`wasm/typst_syntax_bg.wasm`, 359 KB, class `TypstWasmParser` with `edit()`, `edit_many()`, `tree()`, `highlight_range()`), and `typst_lezer()` from `codemirror-lang-typst/lezer`, a **native Lezer grammar for Typst 0.15** using typst-syntax node names, plus completions for built-ins and parameters.
  - I tested it locally. `typstParser.parse("= Intro\nHello *bold* ... #table(columns: 2)[a][b]")` returns a full lossless CST: `Heading > HeadingMarker, Markup > Text`, `Strong > Star, Markup, Star`, `FuncCall > Ident, Args > Named, ContentBlock`, `Equation > Math > MathAttach`, `ListItem > ListMarker`, with `Space` trivia preserved.
  - The same tree drives CodeMirror highlighting, approach-B decorations and the PM projection.
- **`@myriaddreamin/typst-ts-parser@0.7.0`**: only exposes semantic tokens (`TypstParser.get_semantic_tokens_by_string`). It does not return a tree.
- **tree-sitter-typst** ([uben0/tree-sitter-typst](https://github.com/uben0/tree-sitter-typst)) via `web-tree-sitter@0.27` (WASM build: `@lumis-sh/wasm-typst@0.26.3`). It works, but node names differ from typst-syntax, it has historically lagged syntax versions, and it needs a WASM runtime. It is not needed if Lezer is used.
- **Custom WASM build of `typst-syntax`** (`SyntaxNode`, `LinkedNode`, `Source::edit` incremental reparse) via wasm-bindgen. This gives the exact parser but means maintaining Rust↔JS tree marshalling. Keep it as a fallback or validator, for example to cross-check the Lezer CST in tests.

### Sources
- [Overleaf visual extensions (source)](https://github.com/overleaf/overleaf/tree/main/services/web/frontend/js/features/source-editor/extensions/visual)
- [TeXlyre/codemirror-visual-markup](https://github.com/TeXlyre/codemirror-visual-markup) · [TeXlyre](https://github.com/TeXlyre/texlyre)
- [ortic/typst-wysiwyg](https://github.com/ortic/typst-wysiwyg)
- [Typst editor list (uptonking)](https://github.com/uptonking/note4yaoo/blob/main/lib-edit-typst-examples.md)
- [TyX](https://github.com/tyx-editor/TyX)
- [Quarto visual editor markdown](https://quarto.org/docs/visual-editor/markdown.html)
- [docmost lossless markdown PR](https://github.com/docmost/docmost/pull/2540)
- [CodeMirror decoration example](https://codemirror.net/examples/decoration/) · [discuss: WYSIWYG markdown in CM](https://discuss.codemirror.net/t/implementing-wysiwyg-markdown-editor-in-codemirror/2403)
- [ProseMirror](https://prosemirror.net/)
- [kxxt/codemirror-lang-typst](https://github.com/kxxt/codemirror-lang-typst)
- [uben0/tree-sitter-typst](https://github.com/uben0/tree-sitter-typst) · [web-tree-sitter](https://www.npmjs.com/package/web-tree-sitter) · [@lumis-sh/wasm-typst](https://www.jsdelivr.com/package/npm/@lumis-sh/wasm-typst)

