# Architecture

This is the technical companion to the product concept in
[docs/2026_10_10_concept.md](docs/2026_10_10_concept.md). It describes the code as it is. When the
code changes, update this file in the same commit.

## Repository layout

```
src/                        the widget (TypeScript); the most important API on top
  index.ts                  public API of the package; registers <typst-editor>
  typst-editor.ts           createTypstEditor() — composes the widget: Project, layout, editing views, preview, file
                            panel, status bar, scoped CSS (typst-editor.css)
  typst-editor-element.ts   <typst-editor> custom element (shadow DOM) around createTypstEditor
  typst-editor/             what only typst-editor.ts uses: editing-views.ts (Visual/Source tabs, lazily one
                            VisualView + SourceView per document), project-renderings.ts (what a document's Visual
                            view renders and inserts: snippets, image URLs, uploads), collaboration-link.ts,
                            pdf-export.ts (the project's PDF with / without comments), file-navigation.ts
                            ("← previous file" / "next file →" around an included file)
                            layout.ts + layout.css (side panels with rail buttons, editing area, preview)
  typst-editor-element/     inline-source.ts (source written inside the element → text)
  stylesheets.test.ts       every .css under src/ parses (lightningcss, no error recovery), no nested style rules,
                            every block closed (an unclosed rule silently nests the rest of the file)
  core/                     the models everything builds on
    typst-document/         TypstDocument — the single source of truth (string or shared Y.Text); Highlight (a
                            styled source range views draw); Presence / PresenceTarget (other users' carets +
                            selections, the interface both views implement); minimal-change.ts, y-delta.ts
    typst-engine/           typed TS wrapper around the wasm (typst-engine.ts: createEngine), fetch-fonts.ts;
                            engine-assets.ts (wasm + default font URLs for the main thread); packages/ (withPackages,
                            tar reader); fixtures/ (test package archives); generated wasm/, fonts/ (gitignored)
    project/                Project: the file model (one TypstDocument per .typ file, main protected); paths.ts
                            (names → paths, Typst path resolution, file kinds); FileContent; path-references.ts
                            (the file paths a Typst text names; FileLinks); reading-order.ts (main file, then
                            its #includes depth first; a file's neighbours in that order); imports.ts
                            (importChange: import a name from a module once, used by margin notes and styles)
  features/                 one folder per feature, each entered through the file named like it
    visual-view/            VisualView — Tiptap editor over the source-anchored projection; visual-view.css
                            (ProseMirror core styles); decorations at the root: highlights, change-decorations,
                            presence; field-popover.ts (also used by versions/)
      projection/           projection.ts (source ↔ document), raw-code, alignment, call-atoms, labels (label/ref syntax),
                            embedded-code
      nodes/                nodes.ts (the schema: Tiptap extensions), raw-box, rendered-box, code-block-view,
                            page-break, horizontal-rule, task-list + checklist-preamble, heading numbers, text-align,
                            margin-notes, box-links (an image box's path as a link)
      images/               images.ts: image choices, insertion, image tools (resize, alt, caption), image-call edits
      references/           references.ts: the `reference` node (@key chips), label tags, reference hints, the @ list
                            (reference-suggestion), label-edits, label-choices
      toolbar/              toolbar.ts, toolbar-action, toolbar-blocks, toolbar-menu, floating-bar
      notes-gutter/         notes-gutter.ts (comment column), note-card (a note's thread + reply box), note-list,
                            card-layout
    source-view/            SourceView — CodeMirror 6 editing view; typst-language, lint, presence, file-links
                            (Mod+click / Alt+Enter / tooltip on paths; also used by raw boxes)
    preview/                Preview — worker-backed live preview + hit-testing, zoom, page numbers, PDF export;
                            toolbar.ts, pdf-menu.ts ("Download PDF" + menu), latest-only.ts ("only the newest
                            value" task runner)
      worker/               worker.ts (startEngineWorker, main-thread side), engine.worker.ts (the worker),
                            protocol.ts (messages), project-files.ts (FileSender/FileReceiver)
      pages/                pages.ts: page-list (SVG only near the viewport), geometry, zoom, snippet, change-bars
    diagnostics/            DiagnosticsStatus (status bar), diagnostics-summary.ts
    labels/                 LabelIndex: the project's labels (kind, title, file) and reference counts; scan.ts (Lezer, .bib)
    styles/                 StyleIndex: the custom styles the project declares (`/// @style …`), discover.ts,
                            new-style.ts ("New style…" stub); DocumentStyles (what a Visual view uses)
    changes/                ChangeTracking (a base per Typst file + "Changes since …"), diff.ts (diffTexts), changes.css
    comments/               CommentAction ("Comment" / Ctrl+Alt+M), add-margin-note.ts, margin-note-syntax.ts
                            (drafting's call: parse, print, validity), note-thread.ts (a note's body as a
                            thread of messages), page-margin.ts, without-notes.ts (the PDF without comments)
    files/                  FilePanel (the file panel: header, prompts, drops; files.css), icons.ts, asset-view.ts,
                            upload.ts
      tree/                 tree.ts (FileTree: rows, keyboard, drag & drop, presence), tree-model.ts (pure)
    collaboration/          real-time collaboration (loaded on demand): Collaboration, SharedProject, RemoteCursors,
                            RoomVersions + SharedAssets (GitLab rooms); in-process.ts (Y.Doc/awareness wiring for
                            tests); gitlab-protocol.ts (import-free, shared with the server)
    versions/               VersionControls: "Save version", commit message, outcome (GitLab rooms)
crates/typst-engine/        Rust → wasm: Typst compiler, SVG and PDF export, click/cursor jumps
  src/world.rs              in-memory Typst World (files and fonts pushed from JS)
  src/lib.rs                wasm-bindgen interface (JSON in/out, UTF-16 offsets)
server/                     collaboration server (Node package, Hocuspocus; TypeScript run by Node directly)
  src/gitlab/               GitLab-backed rooms: GitLabExtension, GitLabRoom, GitLabProject (REST), merge, commit actions,
                            HTTP endpoints, FakeGitLab (in-process, for tests and server:dev-fake-gitlab)
  src/playground/           dev-only: playgroundOptions (fake GitLab with the advanced example + webhook),
                            PlaygroundEndpoints (GET /playground, POST /playground/upstream), readProjectFiles
demo/                       the playground (vite root; checklist: docs/demo-playground.md); ?example=hello|simple|advanced
                            picks a project from demo/examples/<name>/ (examples.ts: import.meta.glob → file map);
                            playground.ts (URL ↔ state: example, room → Local/Collaborate/GitLab mode, user),
                            server-status.ts (probe ws://127.0.0.1:1234, simulate upstream), playground-bar.ts (the bar)
examples/plain-html/        <typst-editor> loaded from dist/lib without a bundler
tests/e2e/                  Playwright specs (run against the static build); tests/jsdom-setup.ts (vitest setup file)
eslint-rules/               entry-imports.js: the folder boundary rule (below)
mise-tasks/                 every script (build, test, quality, …) — `mise tasks ls`
docs/                       research and concepts (YYYY_MM_DD_slug.md)
```

### Folder rules

- **Entry files.** Every folder under `src/` has one entry file named like it (`preview/preview.ts`;
  a stylesheet may be `changes/changes.css`). Everything else in the folder is internal to it, and
  folders that grow get subfolders named after a concept (`projection/`, `worker/`), never generic
  ones. A folder beside a file of the same name (`typst-editor/` next to `typst-editor.ts`) holds
  that file's internals. `core/` and `features/` only group.
- **Imports from outside a folder go to its entry file**, which re-exports what others need.
  ESLint enforces this (`local/entry-imports`, `eslint-rules/entry-imports.js`); only TypeScript and
  CSS sources count (not the generated `wasm/`, `fonts/` or the `fixtures/`). The exceptions are
  listed once, with reasons, in `eslint.config.js` (`boundaries.exceptions`):
  - `features/collaboration/gitlab-protocol.ts` — anyone: import-free, shared with `server/` and
    `features/versions` (which must not load the lazily loaded collaboration chunk);
  - `core/typst-engine/engine-assets.ts` — `features/preview/preview.ts`: the asset URLs; in the
    entry, the worker bundle (which imports the entry) would emit every asset a second time;
  - `features/collaboration/in-process.ts` — test files;
  - `features/collaboration/shared-project.ts` — the server's tests.
- **Top comments.** Every source file starts with a comment: its context, `See <entry file /
  ARCHITECTURE.md section>`, or `Tests for X` (`mise run quality:top-comments`, part of `quality`).
- Other languages and separate programs stay at the top level: `crates/`, `server/`, `demo/`,
  `examples/`.

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
│  │  scroll to      ◄────────────────────────────────┼────┼───│ [{page,x,y}]           │
│  └──────────────────────────────────────────────────┘    │   └────────────────────────┘
└──────────────────────────────────────────────────────────┘
```

## Modules and their contracts

### `createTypstEditor` / `<typst-editor>` (`src/typst-editor.ts`, `src/typst-editor/`, `src/typst-editor-element.ts`, `src/index.ts`)

```ts
createTypstEditor(host, { source?, main?, files?, mode?, fileList?, allowFileChange?, onFilesChange?, onChange?,
                           user?, base?, baseLabel?, collaboration?, onOpen?, followCursor?, pdfDownload? })
  → { source (get/set), files (get/set), activeFile, open(path), setBase(base, label?), exportPdf({comments?}) → Promise<Blob>,
      destroy() }
<typst-editor value="…" file-list="auto|show|hide" pdf-download="hide">   .value, .files, .user, .collaboration,
  setBase(base), exportPdf({comments?}); 'change' {detail:{value}}, 'files-change' {detail: FileChange}, 'open' {detail:{path}}
```

- `source` is the text of the main file at `main` (default `/main.typ`; falls back to
  `files[main]`). `files` (`ProjectFiles = Record<path, string | Uint8Array>`) are the project's
  other files. Assigning `files` replaces them (documents of paths that stay are kept and get the
  new text as one edit) and recompiles. `@preview` packages need no entry.
- **Composition** (`Widget`, private): `Project` + `Layout` + `EditingViews` + `FilePanel` +
  `AssetView` + `Preview` + `DiagnosticsStatus`. The preview always compiles `main` with `project.files()`.
- **`Project`** (`core/project/project.ts`): files by path. `.typ` strings become a `TypstDocument` each (kept
  across renames, so open views survive); everything else is stored as given.
  `check(change)` → reason or null, `apply(change)`, `replace(files)`, `onChange(change)`
  (structural changes and every document edit as `update`). The main file cannot be renamed or
  deleted; `.typ` files keep their ending.
  `FileChange = {kind:'create', path, content} | {kind:'update', path, content} | {kind:'delete', path} | {kind:'rename', from, path}`.
- **`EditingViews`**: one Visual/Source tab bar; a document's views are created the first time
  it is shown and then only hidden, so cursor and undo history survive switching. The mode is
  shared. With a single file the DOM is the same as before (tabs + two panes).
  `setFrame(top, bottom)` keeps two elements first and last in the visible pane (they scroll with
  the file). The widget puts `FileNavigation` there: for a file the main file `#include`s
  (`neighbours(files, main, path)` from `reading-order.ts`, recomputed on open and every change),
  links to the file read before it and the one after it, both at the top and at the bottom;
  nothing for the main file or files outside the include order.
- **`FilePanel`** (see "File panel" below) lives in the `Layout`'s `files` panel: open by default
  when `fileList` is `show`, or `auto` with more than one file; `hide` removes it with its rail
  button. A requested change passes `project.check`, then the host's `allowFileChange` (async
  allowed; re-checked afterwards), then is applied. Files dropped anywhere on the widget are
  uploaded unless `fileList` is `hide` (then ignored) — never left to the browser, which would
  open the file in place of the page. Image files dropped into the Visual view's text are taken
  there instead (uploaded and inserted at the drop point).
- **File links** (see below): each document's views get a `FileLinks` (`Widget.fileLinks`:
  paths resolve from the document's current path; `open` is `Widget.open`; `create` is a
  `create` change through `request`, then `open`).
  `onCreate(document, views)` reports new views (the widget attaches them to `ChangeTracking`).
- Preview clicks into another project file open it, then reveal. Clicks into packages are ignored.
- **`ProjectRenderings`** gives every document's VisualView its `renderer` (snippets from
  `Preview.snippet` under the document's current path, refreshed on `Preview.onRender`; image
  files resolved like Typst (`resolvePath`) and shown as object URLs, made once per content and
  revoked when replaced) and `assets` (the project's images as `referencePath`s; uploads become
  a `create` change that goes through `allowFileChange` like the file panel's; an upload equal to
  an existing file (`name.png`, `name-2.png`, …) reuses it, a different one gets the first free
  of those names — every pasted screenshot is `image.png`; refusals — not an image Typst shows,
  the host's veto — come back as an error the popover shows).
- **PDF** (`PdfExport`, `typst-editor/pdf-export.ts`): `exportPdf({comments})` and the preview's
  "Download PDF" (`Preview` option `pdf`, unless `pdfDownload: false`). With comments the main
  file is exported as compiled; without, `withoutNotes(project.files(), main)` gives the entry
  and replaced sources (see Comments). No PDF (errors) → an `Error` "The document has n
  error(s): …" (the toolbar shows it), never an older PDF. File name after the main file:
  `main.pdf` / `main-with-comments.pdf`. The plain button is the version without comments
  (decision: the usual final version); the menu has both.
- **Images into the text**: `AssetView` only previews. An image row dragged from the file panel
  (drag type `PROJECT_PATH_TYPE`, data: the project path) and dropped on the Visual view is
  inserted there as an image block (`imageFileDrops` → `ImageAssets.reference(path)`: relative
  when in the same folder tree, else project-absolute; not for non-images).

- Setting `source`/`value` applies **one minimal edit**: only the range between the common prefix
  and the common suffix changes (`minimalChange`), so cursors and undo history are preserved.
- **Styles** go into `host.getRootNode()`: `document.head`, or the element's shadow root.
  CodeMirror mounts its own styles into the same root. Embedding guide: [docs/embedding.md](docs/embedding.md).

### `TypstDocument` (`src/core/typst-document`)

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

### `typst-engine` (Rust crate + `src/core/typst-engine`)

```ts
createEngine(wasm, fonts?: (Uint8Array | Promise<Uint8Array>)[]) → Promise<Engine>
defaultFonts() → Promise<Uint8Array>[]          // engine-assets.ts: fetches the bundled font assets
.addFont(bytes)                                  // throws if bytes contain no font face
.setSource(path, text) / .setBinary(path, bytes) / .remove(path)
.compile(main) → { pages: [{hash, width, height, svg}], diagnostics: [{severity, message, hints, path, from, to}], missingPackages: string[] }
.exportPdf(main) → { pdf: Uint8Array | null, diagnostics, missingPackages }   // keeps the hit-testing document
.jumpFromClick(page, x, y) → {kind:'source', path, offset, from, to, boxes} | {kind:'url'} | {kind:'position'} | null
.jumpFromCursor(path, offset) → [{page, x, y}]
.boxesForRanges(path, [{from, to}]) → [{page, x, y, w, h}]   // where those ranges are drawn: per glyph run, shape, image

withPackages(engine, fetchPackage = fetchPreviewPackage) → { compile(main) → Promise<CompileResult>, exportPdf(main) → Promise<PdfResult> }
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
  pinned by `Cargo.lock` into `src/core/typst-engine/fonts/`. `engine-assets.ts` turns them into bundler
  assets (`import.meta.glob(…?url)`) and starts all downloads at once. The worker passes them to
  `createEngine`, which awaits wasm and fonts in parallel.
- **Packages** are files like any other, under their package path. A file of a package with no
  files at all fails with `PackageError::NotFound` and records the spec; `compile` returns those
  as `missingPackages` (cleared per compile). `withPackages` (TS) loops: compile → fetch the
  missing archives in parallel → `untarGz` → `.typ` via `setSource`, the rest via `setBinary` →
  compile again. A failed download is remembered (no retry until reload) and reported as an extra
  diagnostic with `path: null`, next to Typst's own "package not found" at the import.
- **SVG cache:** page SVGs are keyed by `hash128(&page.frame)`. Unchanged pages skip `typst_svg::svg`.
- **PDF export** (`typst-pdf`, same version as typst, default `PdfOptions`: tagged, no
  timestamp): `exportPdf(main)` compiles `main` with the world's main file set to it and back,
  and does not replace `document` (the last `compile`), so the preview's hit-testing is
  unaffected and the export can use another entry. The wasm returns a `PdfExport` object
  (`pdf()` bytes, `report()` JSON); the TS wrapper frees it. It added 1.9 MB raw / 0.66 MB gzip /
  0.42 MB brotli to the wasm (krilla, subsetter, pdf-writer, …).
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

### `VisualView` (`src/features/visual-view`)

```ts
new VisualView(parent, document, { renderer?, assets?, user?: {name}, comment?(), labels?, links?, styles? })   // user signs replies; comment: the toolbar's "Comment"; labels: ProjectLabels; links: FileLinks; styles: DocumentStyles
.reveal(from, to)    // select exactly what shows source range from..to (caret if empty)
.setHighlights(layer, highlights)   // source ranges → inline decorations (sourceToPos, end with bias -1)
.setPresence(presences)             // other users' carets / selections (PresenceTarget), see Collaboration
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

- **Schema** (`nodes/nodes.ts`):
  - **Blocks:** `paragraph`, `heading`, and `bulletList` / `orderedList` > `listItem` (a `marker`
    attribute; content `(paragraph | rawBlock) block*`, so nested lists made with Tab print
    indented), plus `rawBlock`.
  - `image` (atom block; `src` is the whole `#image("path", ..)` call, edited like a raw block);
    `outline` likewise for `#outline(..)` (the table of contents).
  - `figure` > (`image` (the call without `#`) | `table`) + optional `figureCaption` (a
    textblock). `figure.layout` (an anchor attribute) is the source around the two: `open`,
    caption `before`/`open`/`close`, and `rest` (other arguments, `)`, a label).
  - `codeBlock` (Tiptap's, `language` + anchor `fence`): plain text (no marks), edited in place.
  - `table` > `tableRow` > `tableCell` / `tableHeader` (Tiptap's MIT table extensions, not
    resizable); cells hold blocks. `table.layout` (an anchor attribute) is the source around the
    cells plus the table's `TableStyle` (how its rows are written). A cell written as an
    expression (`ms(18)`) holds one paragraph with one `rawInline` whose `code` attribute is set:
    its `src` is code, without `#` (`embedded-code.ts`).
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
    `softBreak` (a source newline that renders as a space); `hardBreak` (`\`); `rawInline`;
    `reference` (inline atom, `target` + `supplement` as written: `@key` / `@key[..]`, a chip).
  - **Labels:** a global `label` attribute (`{ name, gap }` or null) on every block a markup
    segment can become (paragraph, heading, code block, raw block, image, outline, figure, table,
    quote, alignment, page break, rule). It is printed after the block (`gap` + `<name>`), maps to
    the block's end, and is compared like an anchor in `syncDoc` (a renamed label updates in place).
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
  - A label right after a heading (same line or the next, only spaces between, followed by a
    paragraph break, the end or a block) is the heading's `label`; a label ending a run (after
    content that is not itself a label) is the label of the block the run becomes (a paragraph,
    `#figure(..) <fig:x>`, `$ .. $ <eq:x>`, a code block, a table). Other labels (`= A <a> text`,
    mid-paragraph, in list items) stay `rawInline`. A `Ref` makes a run prose.
  - Every other run up to a `Parbreak` becomes a paragraph if it contains prose (Text, Strong,
    Emph, inline raw, bare URLs, `#link` calls, …) — unless it is exactly one raw element Typst
    shows as a block (3+ backticks around a line break), which is a `codeBlock`. Otherwise, if it
    is exactly one call (`BLOCK_CALLS`, then `callAtomType` in `call-atoms.ts`): an `image` for
    `#image("literal path", ..)`, an `outline` for `#outline(..)`, a `figure` for
    `#figure(image("literal path", ..) | table(..), ..named)` (optionally followed by a label;
    the table modelled as below) whose `caption: [..]`, if any, is one paragraph, a `table` for
    `#table(columns: <int>, ..named, cells)` whose `columns` comes before the cells and whose
    positional arguments are cells filling whole rows (the first row may be a `table.header(..)`
    of cells: header cells). A cell is a closed content block or an expression that reads the
    same after a `#` in markup (`ms(18)`, `x.y`, `"s"`, `1pt`, `$x^2$`; `isEmbeddable`); other
    `table.*` elements (`table.cell` with spans or not, `hline`, `vline`, `footer`), other
    expressions (`-1`, `a + b`, `..xs`) and comments keep the table a `rawBlock`. Then an `alignment` for `#align(<literal alignment>)[..]` (`left|center|right|start|end`,
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
    - text right after a `]` that would continue a call (`(`, `.field`) gets a backslash, and so
      does text right after a reference that would extend its name (`@intro\s`);
    - code text is printed as is, innermost (closed and reopened around other formatting
      changes), in single backticks where possible, else in a fence longer than any backtick run
      inside (`` ``` a`b``` ``, a space before the closing fence after a trailing backtick);
    - an edited code block prints ```` ```lang\ntext\n``` ````, keeping its fence unless the text
      needs a longer one; the language is cut to what Typst reads as a tag (`codeLanguage`).
  - Tables print their `layout` gaps around the cells' blocks while they keep the projected shape
    and header state (so a cell edit changes only that cell). A cell written as an expression
    prints its code bare while it holds just that box and the code is still one expression;
    otherwise (text typed next to it, code that is no longer one expression) it prints as
    content, `[#ms(18) more]`, and cleared as `[]`. A table whose shape changed (rows, columns,
    header row) re-prints in its `TableStyle`: the source up to the first row verbatim (named
    arguments, multi-line closures and all) with the new `columns` count, named arguments that
    stood between rows, the separators between cells and between rows of its last rows (so
    indentation and one-row-per-line or all-on-one-line stay), `table.header(..)` as written
    (the bracket form `table.header[a][b]` only while it holds no bare cell) and everything after
    the last row (trailing comma, `)`). Unchanged content cells print their blocks in `[..]`
    (padding inside the brackets is lost), expression cells bare. Editor-made tables:
    `#table(\n  columns: n,\n  [..], [..],\n)`, the first row in `table.header(..)` if it is a
    header row. Block atoms with a `src` (raw blocks,
    images, outlines, page breaks, rules) print it. A quote prints its `layout` (new:
    `#quote(block: true)[` / `]`) around its blocks; a task item `- [x] ` / `- [ ] ` and its paragraph.
  - Figures print their layout around the body (image call or table) and the caption, so each
    changes on its own; an added caption prints `, caption: [..]` right after the image call, a removed one
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
- **Toolbar** (`toolbar.ts`, created by `VisualView` above the editor), kept short: undo/redo, a
  text style menu (normal text, heading 1–3), bulleted/numbered/task list, an **Align** menu
  (left, center, right, justify; its icon is the current alignment) and an **Insert** menu (image,
  table, table of contents — an `#outline()` block —, code block, quote, horizontal rule, page
  break), and "Comment" when the view has a `comment` option (enabled with a caret or selection
  in text outside code blocks). Menus: `toolbar-menu.ts` (`role="menu"` of toolbar buttons;
  Escape, outside click, arrow keys). Two bars float in the text column (`floating-bar.ts`,
  placed in `.typst-visual__body` so they scroll with the text, shown while the text or the bar
  has focus): **Selection** (bold, italic, code (Mod+E), link, comment) above a text selection
  or a link holding the cursor — the only place of the mark buttons —, and **Table** (add/delete
  row/column, header row) above a table holding the cursor (not while the Selection bar shows).
  Entries are `Action`s (`toolbar-action.ts`; block-node entries in `toolbar-blocks.ts`): Tiptap
  chain commands; after every transaction the buttons show `aria-pressed` and are disabled when
  `editor.can()` (or the action's own `enabled`) says no.
  Mousedown is cancelled, so the text keeps focus and selection.
  - Link (and Mod+K in the text; its popover sits in the Selection bar, also shown for a caret then) and insert image (popover at the Insert menu) ask for a value in a `FieldPopover`
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
- **References and labels** (`references/`, given the project's labels as `ProjectLabels`):
  - Reference chips show the label's name; `referenceHints` adds what it labels (`data-hint`,
    "Section · Method", "Figure · <caption>", from `describeLabel`) as a hover tooltip only or marks it
    `typst-visual__ref--unknown` (wavy, tooltip) when the project has no such label. Redrawn when
    the doc or the label list changes.
  - `labelTags`: a widget per labelled block — at the end of a textblock's text, below other
    blocks. Clicking it opens a `FieldPopover`. While anything refers to the label, the default (Enter)
    is **Rename and update N references**, which also renames the references (this view: in the same transaction, one undo step;
    other files: `ProjectLabels.renameReferences`, one change per file), and **Rename without
    updating references** is the alternative. Without references the default is **Rename**. Remove removes it. Names
    are cleaned up by `labelName` (spaces → `-`).
  - `referenceSuggestion` (own plugin, not `@tiptap/suggestion`: its popup mounts into
    `document.body` and its outside-click check fails across the shadow root): `@` after a
    space/bracket/line start in prose opens a list (`labelChoices`: name prefix, then name, then
    title matches; at most 8) below it, inside `.typst-visual__body`. ArrowUp/Down, Enter/Tab or a
    click insert the chip in place of `@query`; Escape dismisses that `@`. Typing a space or
    punctuation right after the whole name of a label (`@intro `) inserts the chip as well.
  - Without `labels`: tags only (rename and remove of the label itself).
- **Text alignment** (`text-align.ts`, `alignment.ts` for the Typst syntax):
  - Commands `setTextAlign(left|center|right|justify)` and `unsetTextAlign`; shortcuts
    Mod-Shift-L/E/R/J; four items of the toolbar's Align menu, pressed by `textAlignAt(state)`.
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
  headed by "Image: <path>" (`imagePath(src)`; with `links` the path opens the file), an outline box
  by "Table of contents"; with a renderer, the outline shows its compiled snippet. With `links`
  (`setBoxLinks`), every box's code gets the Source view's `fileLinks` extension (link tooltip
  on a path, Mod+click opens; no separate "Open …" row: it took too much space).
  - **Rendered boxes** (`rendered-box.ts`, with a `BoxRenderer`): while not focused, a box shows
    an `<img>` instead of its code: an `image` box its file (`renderer.imageUrl(path)`, follows
    path edits at once), any other box the compiled snippet of its source range
    (`renderer.snippet(from, to, src)` as an SVG data URL; refreshed on `renderer.onChange`).
    Block boxes size it in pt; inline boxes in em of the text around them (`inlinePictureSize`:
    scaled so the snippet's `textHeight` is a 1.15em text line, the padding taken back by
    negative vertical margins), so a one-line snippet is one line high and its text the size of
    the text around it. Boxes starting with `#set`/`#show`/`#let`/`#import`/`#include` or a
    comment (`rendersInPlace`) and boxes whose snippet is null keep showing code. Focus in
    the code (click on the picture — for images: double-click —, arrow keys, Enter) shows the
    code; focus leaving it shows the picture again.
  - An edit sets `attrs.src` with an attribute step (positions and the outer selection stay put);
    the projection prints `src` verbatim, so the source changes exactly there.
  - An outside change of `src` (via `syncDoc`) reaches the box as one minimal change.
  - Undo/redo in a box run the Visual view's history. Arrow keys at a box's edges, Escape (and Enter
    in inline boxes) move into the outer editor; arrow keys in the outer editor (and Enter on a
    selected box) move into a box; Backspace in an empty box deletes it.
  - Inline boxes are inline-level all the way down (`<span>`s and an `inline-flex` editor, which
    must override CodeMirror's `display: flex !important`): a block inside the box's `<span>`
    would split it into three lines.
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
  `toggleHeadingNumbering` (no toolbar button; meant for the Inspector's document section) adds `#set heading(numbering: "1.")` after the leading raw blocks or
  removes the numbering arguments. Rules in content blocks, show rules and numbering functions are
  not followed (the preview is exact).
- **Track changes** (`change-decorations.ts`): a ProseMirror plugin holds the projected base
  and, on every doc change, decorates `diffTexts(print(base), print(doc))` through
  `sourceToPos`: insertions as inline marks, deletions as struck-through `<del>` widgets with
  the deleted *visible* text (taken from the projected base), a change whose visible text is
  the same on both sides as a formatting change, and raw boxes inside a change outlined.
- **Remote presence** (`presence.ts`, Tiptap CollaborationCaret look, but fed from our text sync):
  a caret is a widget decoration (bar + name flag, always shown) at `sourceToPos(head)`, so it
  shows in empty paragraphs too; a selection uses the highlight layers' range decorations. A
  caret inside a box (block atoms — raw blocks, images, outlines, page breaks, rules — from
  their first character to their line end; `rawInline` / `marginNote` strictly inside) outlines
  the box instead (node decoration `typst-remote-box`, the names as flag, first user's color);
  the decoration carries the carets' offsets in the box's source, and a raw box draws them in
  its nested CodeMirror (`RawBox.update(node, decorations)`). Mapped through edits until set again.
- **Invariants (unit-tested):**
  - `print(project(src)) === src` for every fixture (incl. links, images, figures, tables, unmodelled
    tables and figures, quotes, page breaks, rules, table headers, task lists);
  - edits change only what they touch;
  - an outside change to a paragraph keeps the cursor position in it.

### `SourceView` (`src/features/source-view`)

```ts
new SourceView(parent, document, { onCursor?, onBaseChange?, links? })   // links: FileLinks, see "File links"
.reveal(from, to)    // select, scroll to center, highlight
.setDiagnostics([{severity, message, hints, from, to}])   // underline + hover; replaces previous
.setHighlights(layer, [{from, to, className, attributes?}])  // replaces that layer; follows edits
.setPresence([{id, user: {name, color}, anchor, head}])      // other users (PresenceTarget); follows edits
.selection() → {from, to}
.showChanges(base | null)   // inline unified diff against base, accept/reject per chunk
.destroy()
```

- **Presence** (`presence.ts`, y-codemirror style): each caret is a widget (bar + dot, also on
  empty lines); its name flag shows on hover and for 2.5 s after the caret moved (the widget is
  re-created only then: `moves` counts in its equality). Selections are tinted marks. The same
  extension draws carets in the Visual view's raw boxes.
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

### `Preview` (`src/features/preview`)

```ts
new Preview(container, { onJump?, onDiagnostics?, pdf? })   // renders a toolbar + scrolling page area into container;
                                             // pdf: (comments) → Promise<{blob, name}> adds "Download PDF" (PdfMenu)
.update(files: Record<path, text | Uint8Array>, main)    // cheap per keystroke
.reveal(path, offset)                        // cheap per cursor move: scroll only if off-screen (no marker); nothing while not following
.setFollow(on)                               // "Follow cursor" (toolbar on/off switch, role=switch; options follow / onFollowChange); on → goes to the newest reveal
.showChanges(path, ranges | null)            // change bars in the page margin per path (all paths drawn), redrawn after every compile
.snippet(path, from, to, text) → Promise<{svg, width, height, textHeight, padding} | null>   // the range as drawn, cut from its page
.onRender(listener) → unsubscribe            // after every successful compile
.exportPdf(main, sources = {}) → Promise<PdfResult>   // the files of the last update(), sources replacing/adding texts
.destroy()
```

- **Snippets** (`snippet.ts`): no extra compilation. After running compiles are done, the range
  goes to `boxesForRanges`; the union of the boxes on the first box's page (+2 pt, clamped to
  the page) becomes the page SVG with that `viewBox` and size in pt; `textHeight` is the tallest
  box (one line of its biggest text), `padding` the 2 pt. Null when the range draws
  nothing, or when `text` is not what the range held at the last successful compile (it was
  edited since, or the document has errors), so a snippet never shows other source.
  A call whose drawn glyphs all come from its definition (`ms(6)` with `#let ms(v) = [#v ms]`:
  the glyphs' spans lie in the `let`) draws nothing in its own range, so its box keeps showing code.

- **PDF menu** (`pdf-menu.ts`): "Download PDF" (without comments) plus ▾ with a `role=menu` of
  "Without comments" / "With comments" (Escape or a click outside closes it). While a PDF is
  made the buttons are disabled and the status says "Making PDF…"; the source's rejection shows
  as "No PDF: <message>" (click dismisses). The file is saved through an object-URL link.
  `exportPdf` waits for running compiles (`LatestOnly.idle`), so it exports the newest text.

- **Change bars** (`change-bars.ts`): each path's ranges go to the engine's `boxesForRanges`
  (one request per path, boxes merged) after every successful compile and after `showChanges`
  (coalesced to one draw per microtask); boxes on the same or adjacent lines join into one bar
  (like LaTeX `changebar`). A pure deletion (empty range) takes the characters on either side.
  Bars are page overlays like the highlights; only the newest draw wins.

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
- **Overlays** (click highlight, change bars) are children of the page element, positioned in
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

### Worker protocol (`src/features/preview/worker`)

```
main → worker   {type:'init', wasm}  (first, once; the URL is resolved on the main thread)
main → worker   {id, type:'compile', files: Record<path, text | Uint8Array | null>, main} | {id, type:'click', page, x, y} | {id, type:'cursor', path, offset} | {id, type:'boxes', path, ranges}
                | {id, type:'pdf', main, sources: Record<path, text>}
worker → main   {id, type:'compile', result} | {id, type:'click', jump} | {id, type:'cursor', positions} | {id, type:'boxes', boxes} | {id, type:'pdf', result}
                | {id, type:'error', message}
```

- Requests are answered in order, because the worker is single-threaded, except that a
  `compile` waiting for a package download lets `click`/`cursor` requests overtake it.
- `compile` sends the full file map; `null` means "the same bytes as last time" (`FileSender`).
  The worker (`FileReceiver`) removes paths missing since the previous call, and Typst diffs the
  text itself. Package files are not part of the map and stay loaded.
- `pdf` exports with the files of the last `compile`; `sources` replace or add text files for that
  export only (`FileReceiver.withSources`), restored afterwards. `compile` and `pdf` run one at a
  time (also across package downloads), so neither sees the other's files. A `click`/`cursor`
  that overtakes a `pdf` waiting for a download reads the export's sources (rare: the generated
  entry only imports drafting, which the document has loaded already). The PDF's buffer is
  transferred, not copied.

### Labels and references (`src/features/labels`)

```ts
new LabelIndex(project)        // implements ProjectLabels; createTypstEditor makes one per widget
.labels() → LabelInfo[]        // { name, kind: heading|figure|table|listing|equation|bibliography|null, title, path }
.referenceCount(name)          // @name references in all files
.renameReferences(from, to, except?)   // edits the other .typ files, one change each
.onChange(listener) → unsubscribe      // only when the label list changed
.refresh()                     // rescans every file: after Project.replace (assigning `files`), which emits no events
.destroy()
```

Every `.typ` file is scanned with Lezer (`scan.ts`) when the index is made and again on each of
its changes (the Project's change events); `.bib` files give their entry keys. A label's kind and
title come from the element before it: a heading (its text), `#figure(..)` (by its body: image →
figure, table → table, raw → listing; its caption), an equation. The Visual view reads the index
through `ProjectLabels` (see "VisualView"); the Source view does not use it yet.

### Custom styles (`src/features/styles`, `visual-view/nodes/styles.ts`, `visual-view/toolbar/style-menu.ts`)

Concept: docs/2026_10_10_custom-styles.md, option (a). A style is a Typst function declared with a
doc comment; the editor never keeps a registry of its own:

```typst
/// @style paragraph Note
#let note(body) = block(fill: luma(240), inset: 8pt, body)
/// @style text Keyword
#let key(body) = text(weight: "bold", body)
```

```ts
scanStyles(text) → [{ name, kind: paragraph|text, label }]   // `///` line + `#let f(body, named: ..)` (one positional parameter)
new StyleIndex(project)   .styles() → Style[] (+ path)   .onChange(listener)   .refresh()   .destroy()
.forDocument(document) → DocumentStyles { styles(), onChange(), importChange(text, style, use) → TextChange | null, create?() }
importChange(text, { name, matches(module), create(), use? }) → TextChange | null   // core/project/imports.ts
newStyle(text) → { text, from, to }   // "New style…": `new-style`, `new-style-2`, … appended to /styles.typ
```

- **Projection:** `project(text, schema, styles)` gets the declared names. A run that is exactly
  `#name(..)?[content]` of a paragraph style is a `styledBlock` (attrs `name`, `title`, `sep`,
  `layout` = the call around the content, like a block quote) holding blocks; inline
  `#name(..)?[text]` of a text style is text with a `style` mark (attrs `name`, `title`, `head` =
  `#name(..)[`, printed again as written). Undeclared calls, paragraph styles inside a sentence, an
  empty text style and calls with two content blocks stay raw. New ones print `#name[..]`.
- **Visual view:** re-projects when the style list changes (a call turns from a raw box into
  styled text). The style menu (`StyleMenu`) lists *Paragraph styles* and *Text styles* after the
  headings and "New style…"; it shows the selection's paragraph style. Paragraph styles wrap the
  selected blocks (`wrapIn`, or rename the style around them); *Normal text* lifts them out;
  text styles toggle the mark (inclusive, like bold; one at a time). After applying one, the view
  adds the import (`DocumentStyles.importChange` at the selection; relative to the file, never
  into the file declaring it, a new import followed by a blank line so it stays its own block).
- **Look:** `.typst-visual__style.typst-style--<name>` (accent bar, the title as a badge) and
  `.typst-visual__style-text.typst-style--<name>` (dotted underline, title as tooltip); hosts
  style a style by its class. The preview shows the real look.
- **Widget:** one `StyleIndex`; "New style…" appends a stub to `/styles.typ` (created through the
  usual file request when missing) and shows it in the Source view.

### Layout (`src/typst-editor/layout.ts`)

```ts
new Layout(host, storageKey)   .editor  .preview            // the editing column and the preview column
.addPanel(id, { label, icon }) → body element             // a side panel + its rail button
.setDefault(id, open)  .setAvailable(id, available)  .choose(id, open)  .isOpen(id)  .dismiss()
.remember<T>(name) → { load(), save(value) }               // sessionStorage `${storageKey}:${name}`, failures ignored
```

- One grid on the host: side (rail + open panel) | editing column | preview; the status bar
  spans all. The preview is a share of the widget (default half; the separator on its left edge
  sets it, drag or arrow keys, 20–80%, saved with the layout, applied as `--te-preview-share`), so
  opening or resizing a side panel narrows only the editing column (down to min(20rem, 25%), then
  the preview gives way too). The hand-built version of the `Layout` module planned by the dockview spike
  (docs/2026_10_10_dockview-spike.md): panels have ids, one side panel is open at a time, the
  saved state (width, who opened or closed what) is opaque to the panels.
- A panel's owner sets its default (`setDefault`: the file panel's `auto` follows the file count);
  a person's toggle wins for the session. The panel is resizable (separator: drag or arrow keys,
  160–480px).
- **Narrow** (widget < 720px, `ResizeObserver`): the open panel overlays the editing column, starts
  closed, opens only on the rail button and closes on Escape, a click outside, or `dismiss()`
  (the widget calls it after a file was chosen in the panel).

### File panel (`src/features/files`)

```ts
new FilePanel(parent, dropTarget, { onOpen(path), onChange(change) → Promise<reason | null>, memory? })
.render({ paths, main, active })   .showPresence(placedPresences)   .acceptDrops = boolean   .destroy()
// tree/: new FileTree(parent, { onOpen, onRename, onDelete, onMove(source, folder), onUpload(files, folder), memory? })
// tree-model.ts (pure): buildTree(paths, emptyFolders), visibleRows(tree, expanded), navigate(rows, current, key),
//                       relocate(paths, source, target) → renames, filesUnder, folderOf, ancestorsOf
```

- **Only gestures → `FileChange`s** (names via `toPath`: any folder depth, default extension);
  refusals show inline in a prompt above the tree. A gesture that needs several changes (a
  folder's rename / move / delete: one per file) asks for them in order and stops at the first
  refusal.
- **Tree**: folders first, then files, both by name (`Intl.Collator`, numeric). `role=tree`, one
  `treeitem` per visible row (`aria-level`, `aria-expanded`, `aria-selected` on the shown file;
  roving tabindex). Open folders are remembered (`memory`, the Layout's session store); the
  folders around the shown file open when it changes. Presence dots per file, and on a closed
  folder for the files inside.
- **The focused row** (click, keyboard; else the shown file) is what Rename / Delete / F2 /
  Delete act on and where New file, New folder and Upload put things. The main file and a folder
  holding it cannot be renamed, moved or deleted.
- **Empty folders** exist in the panel only (the project has no folders), until a file goes in.
- **Drag & drop**: a row dragged onto a folder row (or a file row: its folder; empty space: the
  top level) is relocated there; files from the computer dropped on a row are uploaded into that
  folder (the tree stops the drop, so the widget-wide handler does not upload them again).

### File links (`src/core/project/path-references.ts`, `src/features/source-view/file-links.ts`, `src/features/visual-view/nodes/box-links.ts`)

```ts
findPathReferences(text, { tree?, from?, to? }) → [{ path, from, to, call }]   // call: import | include | image | read | json | …
pathReferenceAt(text, offset, tree?) → PathReference | null                    // the string holding offset (quotes included)
interface FileLinks { resolve(reference) → path | null; exists(path); open(path); create(path) → Promise<reason | null> }
describeLink(links, reference) → { path, name, exists, creatable } | null      // creatable: a missing .typ file
fileLinks(links) → CodeMirror extension      linkInfo(doc, links, reference, { hint? }) → "Open …" / "Create …" DOM
```

- **One definition** of what a path reference is (Lezer, `codemirror-lang-typst`): the string of
  `import "…"` / `include "…"` and the first positional string argument of `image`, `read`,
  `json`, `csv`, `yaml`, `toml`, `xml`, `cbor`, `bibliography` (also the strings of a
  bibliography array); escapes decoded; packages (`@…`), empty strings, named arguments, computed
  paths and methods (`image.decode`) are not references. Callers with a parsed tree (an editor's
  `syntaxTree`) pass it, and a range to look at the visible part only.
- **Source view** (`fileLinks`): paths are marked (`typst-source__path`, underlined on hover, a
  pointer while Ctrl/⌘ is held: `typst-source--mod`); Mod+mousedown on one opens an existing file
  (else CodeMirror's own Mod+click); Alt+Enter opens the file whose path holds the cursor (F12
  was avoided: browsers take it for the developer tools); the hover tooltip is `linkInfo`: "Open
  x (Ctrl+click or Alt+Enter)", or "x is not in the project" + "Create x" for a `.typ` file
  (showing the host's refusal).
- **Visual view**: the nested CodeMirror of every raw box gets `fileLinks` (the same tooltip as
  the Source view; no "Open …" row); an image box's path is a button.
- **Widget**: `open` shows the file (the panel selects it and opens its folders); `create` asks
  for a `create` change like the panel's New file.

### Diagnostics in the widget (`src/features/diagnostics`)

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

### `diffTexts` and "Changes since …" (`src/features/changes`)

```ts
diffTexts(base, current) → [{fromA, toA, fromB, toB}]   // A = base, B = current; sorted, UTF-16
```

- The single text diff behind every "Changes since …" rendering (the Source view's merge view runs
  the same `@codemirror/merge` algorithm itself, for its accept/reject chunks).
- **Cleanup for readers:** a change inside a word grows to the whole word; a change touching a
  markup delimiter (`*`, `_`, heading `=`, list markers; Lezer tree of either text) grows to the
  whole construct, so `*bold*` → `_bold_` is one change with unchanged visible text. Grown
  ranges are mapped to the other text through the raw changes and merged when they touch.

```ts
new ChangeTracking(toolbar, { project, preview(path, ranges | null) }, base?)   // the toggle button goes into toolbar
.attach(document, views)            // a document's views (created lazily): showChanges(base | null) from now on
.setBase({text, label} | null, path = main)   // one file's base (label shared); null: every file back to "opened"
.setBases(label, (path) => text | null)       // every file from one version (GitLab: the last commit; null = new)
.accept(document, base)             // the Source view accepted a chunk: that file's base moved, label stays
.resetOpened()                      // a room synced: "opened" = the texts now
.refresh()   .show(on)   .destroy()
```

- **Every Typst file has its own base**, kept per `TypstDocument` (so renames keep it): by
  default its text as opened (a file created since has base `''`, so all of it is new; a
  collaboration room's first sync → `resetOpened` for all); in GitLab rooms each path's
  `RoomVersions.base(path)` (null → `''`), looked up lazily so files arriving later get theirs.
  One toggle, one label for all ("Changes since opened" / "last saved version" / the host's).
- **Diffs only while shown:** off, nothing is computed; on, an edit re-diffs only the edited
  file (`Project.onChange` `update`), structural changes re-render all and clear the preview's
  bars of paths that are gone. Views get `showChanges(base)` when attached and when the base
  or the toggle changes; they follow edits themselves.
- Widget wiring: `EditingViews.onCreate` → `attach`; `onBaseChange` → `accept`;
  `Preview.showChanges(path, …)`; host `setBase(text, label?, path?)`; `VersionControls` →
  `setBases('last saved version', path => versions.base(path))`.

### Comments = margin notes (`src/features/comments`, `src/features/visual-view/nodes/margin-notes.ts`, `src/features/visual-view/notes-gutter`)

Comments are [`drafting`](https://typst.app/universe/package/drafting/) margin notes in the
Typst source itself (`@preview/drafting:0.2.2`): `#margin-note[note]` (point, at a cursor) and
`#margin-note[text][note]` (range: drafting highlights `text`). There is no other comment store:
the preview shows what the compiler draws, and git, diffs, undo and collaboration carry notes as
ordinary text. A thread is a list in the note (one item per message, `*Name* (YYYY-MM-DD): text`,
below), resolving means deleting the call, and an author is whatever the note's text says (the
widget's `user.name` when it writes a message). The PDF download leaves notes out on request
(`withoutNotes`, below).

```ts
// margin-note-syntax.ts: the only module that knows drafting's call syntax
parseNoteCall(src) → {head, text?, note} | null     // head: `#margin-note` plus any `(..named)`
printNoteCall({head, text?, note}) → string         // printNoteCall(parseNoteCall(src)) === src
noteCallSyntax(source, funcCallNode) → {head, text: ContentBlock | null, note} | null   // in a parsed tree
isNoteCallAt(source, from, to) → boolean            // one note call in markup from `#` to exactly `to`
safeNote(markup) → string | null                    // markup that cannot end or swallow its call
addMarginNote(text, {from, to}) → {changes: TextChange[], note} | null   // note: offset of the new (empty) body
NOTE_STYLE                                          // the set-margin-note-defaults(..) call added with a new import
withoutNotes(files, main) → {main, sources}         // the PDF without comments: entry + replaced/added .typ texts
// note-thread.ts: the only module that knows the thread format (all on the note's markup)
readThread(note) → {author, date, text}[]          // author/date null: an anonymous message (markup)
addReply(note, {author, date, text}) → note        // only an insertion after the last item
editMessage(note, index, text) → note | null   deleteMessage(note, index) → note | null ('' = the only one)
localDate(date?) → 'YYYY-MM-DD'
new CommentAction(root, () => {document, view: {selection(), reveal(), editNote?()}} | null)   .button  .comment()  .destroy()
VisualView.editNote(offset) → boolean   // focuses the reply box in the card of the note whose source holds offset
// visual-view/notes-gutter: the notes gutter
new NotesGutter(body, {user?})   .plugin (add to the editor state)  .edit(offset) → boolean  .destroy()
layoutCards([{anchor, height}], {gap, active?, top?}) → tops   // pure: cards beside anchors, no overlap
findNotes(doc) / followNotes(prev, mapping, found, newKey) / setNoteText(tr, note, markup) / removeNote(tr, note)
noteAtSelection(notes, selection) / noteAtOffset(notes, doc, offset)   // note-list.ts, pure ProseMirror
```

- **Syntax** (`margin-note-syntax.ts`): a note is `#margin-note(..named)[note]` or
  `#margin-note(..named)[text][note]` with no syntax errors, a non-empty one-paragraph `text`
  and nothing after the last `]`; any other `margin-note` call is ordinary code. Projection,
  the Visual view and `addMarginNote` all use this one definition.
- **`addMarginNote`** (pure): a selection becomes `#margin-note[selection][]` if the result
  is one note call in markup (`isNoteCallAt`). Bold or italic text the selection starts or
  ends with goes in whole, delimiters included (`bold` in `*bold*` → `#margin-note[*bold*][]`):
  the Visual view maps a selected bold word to the text between the stars, and prints a range
  note around its formatting (`noteRange` is the outermost mark), so the first message sent
  from the card changes only the note. Else (half of `*bold*`, two paragraphs) a
  point note `#margin-note[]` at the selection's end; null where none fits (inside code). The
  import is ensured exactly once: an existing top-level drafting import (any version) that ends
  before the note is kept (`*`, or `margin-note` among its items) or extended (`, margin-note`
  after its last item, also after a trailing comma; `: margin-note` on a bare module import);
  else `#import "@preview/drafting:0.2.2": margin-note, set-margin-note-defaults` goes first in
  the file (a drafting import below the note would not bind the name where the note is),
  followed by `NOTE_STYLE`: `#set-margin-note-defaults(stroke: rgb("#e0a800") + 0.5pt, fill:
  rgb("#fabe1447"), rect: ..)`, a rect with radius 2pt, inset 3pt, 8pt text and a compact list —
  the Visual view's note colours (`--te-note`, `--te-note-line`); drafting uses `fill` for the
  range highlight too. Chosen by rendering samples with the typst CLI
  (`docs/images/notes-pdf-*.png`). Only with an import the editor adds, and only if the file
  does not mention `set-margin-note-defaults` already (a file's own style stays; never two calls).
  The call is global state from where it stands on, like any drafting default.
- **Page margins** (`page-margin.ts`, part of `addMarginNote`'s edits, same undo
  step): drafting 0.2.2 crashes with "type relative length has no method `keys`" when the page
  margin is a single length ([drafting.typ line 640](https://github.com/typst/packages/blob/main/packages/preview/drafting/0.2.2/drafting.typ#L640)
  calls `page.margin.keys()` on anything but `auto`), and Typst turns uniform dictionaries
  (`(rest: a)`, `(x: a, y: a)`) back into a length. So every top-level `#set page(.., margin: m)`
  with such a literal `m` (a length, a sum of lengths, or a side dictionary with one value for
  all four sides) becomes `margin: (right: R, rest: m)`: only the margin argument changes. R is
  4cm (room for drafting's notes), or the next whole cm + 1 when `m` is an absolute length of
  4cm or more (equal sides would be uniform again). `auto`, absent and non-uniform margins,
  variables and spreads are never touched.
- **Threads** (`note-thread.ts`, pure): a note's body is a thread when it is one flat list whose
  items after the first all start with `*Name* (YYYY-MM-DD): `; the first may lack them (a
  hand-written note that got a reply). Such messages are escaped plain text (`escapeText`, plus
  line-start `-`, `+`, `=`, `/ `, `1.`; a line break is `\` + newline, continued 2 spaces deeper
  than the marker; a blank line a paragraph break). Items without name and date are markup, kept
  as written. Any other body (plain text, `- a\n- b`) is one anonymous message; it is rewritten
  only by a reply, which makes it the first item (`- <text>`).
  - Layout: Typst continues an item on lines deeper than the marker's column, unknown for an
    item right after `[`. So a single-line first message is inline (`[- *Ann* (…): text]`), a
    multi-line one uses the block form (`[\n  - …\n]`), and a reply after an inline first item
    starts its own line at column 0 (`[- … \n- *Bob* (…): …]`). A reply is only an insertion
    after the last item, so concurrent replies merge into two items (tested with in-process
    Y.Docs). Only a multi-line edit of an inline first message moves it into the block form.
- **Without comments** (`without-notes.ts`, pure): checked with the typst CLI, drafting's
  `hidden: true` also drops the highlighted text of range notes, and a later
  `set-margin-note-defaults(hidden: false)` turns notes on again (a later call without `hidden`,
  like `NOTE_STYLE`, does not). So `withoutNotes` removes every note call `noteCallSyntax`
  accepts from copies of all `.typ` files (range → its text, point → nothing, a point note alone
  on its line with that line, so no paragraph break appears; notes nested in a removed part go
  with it), and, when a file imports drafting (that version), adds a generated entry
  (`/.without-comments.typ`, or `-2`, … if taken) with `set-margin-note-defaults(hidden: true)`
  and `#include "<main>"` for notes written other ways (`margin-note.with(..)`, calls in code).
  Engine test: the result draws exactly the glyphs of the plain text.
- **`CommentAction`**: "Comment" and Ctrl/Cmd+Alt+M (captured at the widget root). The Visual
  view's toolbar has the button (`VisualViewOptions.comment` calls `CommentAction.comment()`);
  the tab bar keeps `CommentAction.button` for the Source view only
  (`EditingViews.addTabAction(element, 'source')` hides it in the Visual view). Works on the
  shown `.typ` file in the current view (`EditingViews.shown()`), applies the edits as one
  `document.change`, then `VisualView.editNote(note)` focuses the new note's reply box, or the
  Source view puts the caret into `[]`.
- **Visual view, in the text** (`margin-notes.ts`): see `marginNote` / `noteRange` below. A point
  note is a small marker (tooltip: its note), a range note's text is highlighted.
- **Visual view, notes gutter** (`notes-gutter.ts`, like the comment sidebar of Google Docs or
  Tiptap's comments): a column right of the text (`.typst-visual__body` holds the editor DOM and
  the gutter; the column only shows while the document has notes) with a card per note
  (`note-card.ts`), in document order: the highlighted text (range notes), the thread (name in
  bold, date muted, text; oldest first; more than 4 messages collapse to the first, "n more" and
  the last 2), a reply box, and "Resolve note".
  - Replying: Mod+Enter (or the send button) appends a message signed with `user.name`
    (default "Anonymous") and `localDate()`; the first message of an empty note is also sent
    when the box is left (as the old note field saved), replies are not. Own messages (same
    name: a soft rule, not a boundary) and anonymous ones have a pencil: edit in place, Mod+Enter
    or leaving saves, Escape cancels; the last message, if own, can be deleted (the only one: the
    note goes). Every change computes the new note markup (`addReply` / `editMessage` /
    `deleteMessage`, checked with `safeNote`) and is one transaction (one undo step) setting the
    `note` attribute of the atom or mark; everything else stays as written. Mod+Enter and Escape
    put the text cursor after the note. Resolve deletes a point note's atom, or only the
    `noteRange` mark of a range note (its text stays), one undo step.
  - State: a ProseMirror plugin keeps the notes as a list (`note-list.ts`: `findNotes` on every
    doc change, `followNotes` maps the previous notes through the transaction's mapping to keep
    each note's key; a range note may change at one end). The plugin decorates every anchor with
    `data-note-key` (node decoration on a marker, inline decoration over a range) plus
    `--active` / `--hover` classes. The active note is the one at the cursor (innermost range
    note, or a selected marker), a focused card's, or a clicked marker's; hover comes from the
    anchor or the card. Cards are DOM outside ProseMirror, reconciled by key: a card keeps its
    reply box (and a message being edited) with the user's text while the document changes from
    elsewhere (a reply arriving re-renders the thread, unless a message is open) and saves into
    its own note; a card whose note is gone saves nothing.
  - Layout (`card-layout.ts`, pure): cards start at their anchor's top, pushed down below the
    previous card (gap 8px); the active card stays at its anchor and cards above it move up (not
    above the gutter's top). Measuring (anchor rects, card heights; all reads, then writes) runs
    in one `requestAnimationFrame` after a doc change, an active-note change, typing in a card,
    or a resize of the body or the text (`ResizeObserver`, which also covers loaded images; plus
    captured `load` events). No measuring in the projection.
  - Narrow (body narrower than 560px): no column; only the active note's card shows, as a
    popover below its anchor.
  - `editNote(offset)` finds the note in the document: a point note whose call holds `offset`, or
    among range notes whose text ends at the same place (nested) the one whose `][note]` holds it,
    makes it active and focuses its card's reply box.
- **Source view**: plain Typst, no extra decoration.
- Tests: `note-thread.test.ts` (format, round trips, escaping, concurrent replies over Y.Docs),
  `notes-gutter/notes-gutter.test.ts` (cards and threads in jsdom), engine tests compile both
  thread layouts against drafting.
- Engine tests compile both forms against the real package (`src/core/typst-engine/fixtures/drafting-0.2.2`).
- **Removed** with this design (it replaced the sidecar comments of docs/todo/comments.md):
  `src/comments` (Comments, quote anchors, CommentsPanel, CommentsUI), `SharedComments` and the
  Y.Doc `comments` map, `Preview.setMarkers` / `PreviewMarkers`, the widget options `comments` /
  `onCommentsChange`, the `comments` getter/setter, the element's `.comments` and
  `commentschange`, and the `CommentsData` / `TypstEditorCommentsChangeDetail` types.

### Collaboration (`src/features/collaboration`, `src/features/versions`, `server/`)

```ts
createTypstEditor(host, { …, user?: {name, color?},
  collaboration?: { doc: Y.Doc, awareness?: Awareness } | { url, room, token? } })

Collaboration.start(options, { project, user }) → Promise<Collaboration>   // url: waits for the first sync
.sync()   .setCursor(path | null, range?)   .showCursors(path | null, views: PresenceTarget[])   .destroy()
.onPresence((presences: PlacedPresence[]) => …)   // everyone else, in every file, once per change
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
- **`RemoteCursors`** owns awareness and the Y relative positions: publishes the local selection
  and resolves the others' into `Presence`s (`{id: clientID, user: {name, color}, anchor, head}`,
  source offsets) once per microtask after a change of the shown text or of presence. The shown
  file's views get them through `PresenceTarget.setPresence` (decoration details stay in each
  view: see SourceView / VisualView); `onPresence` gets everyone in every file (with `path`),
  only when that changed. Colors: the user's, else a palette entry by name; flag text black or
  white by WCAG contrast (`flagTextColor`). CSS: `--typst-remote-color`, `--typst-remote-text`.
- **Widget presence**: the views of the shown file (above) and the file panel
  (`FilePanel.showPresence`: a dot with initials per user on the files they are in). Not the
  preview (decision 2026-10-10: carets there were noise; the preview is the output).
- **Why not Tiptap's Collaboration / CollaborationCaret** (decision): they are built on
  y-prosemirror, which makes the ProseMirror document the shared truth (a Y.XmlFragment). Here
  the Typst text is the truth (one Y.Text per file) and the Visual view is a projection of it;
  syncing ProseMirror trees would bypass the projection (raw boxes, pristine source, Source
  view and preview all follow the text). So the sync stays text-based and only the *look* of the
  carets follows Tiptap / y-codemirror.
- **Widget (`CollaborationLink`)**: `import()`s `features/collaboration/collaboration.ts` on demand (own chunk, ~37 kB gzip
  with Yjs and the Hocuspocus provider), publishes the selection when the editing views report a change
  (`onSelection` → `selectionChanged()`, once per microtask, while focus is in the editing area;
  not on the DOM's `selectionchange`, which fires before CodeMirror/ProseMirror read the new
  selection and so published the previous one), and moves the cursors along when another file is shown.
- **Server (`server/`)**: `collabConfiguration({ storage?, database?, authenticate?, debounce?, gitlab?, extensions? })`
  → Hocuspocus configuration; `createCollabServer({ port, … })`. Storage keeps every room's Yjs
  state (`onLoadDocument` / `onStoreDocument`; default `@hocuspocus/extension-sqlite`).
  `onAuthenticate` calls an `Authenticate(token, room) → {name?, email?}` check; the stub
  `sharedToken(TYPST_COLLAB_TOKEN)` allows all when unset. The server looks inside the Y.Doc
  only in GitLab rooms.

#### GitLab-backed rooms (`server/src/gitlab`, `src/features/collaboration/room-versions.ts`, `shared-assets.ts`, `src/features/versions`)

A room named `gitlab:<project id or path>@<branch>` is that branch (`parseRoomName`). The server
config (`gitlab: {url, token, webhookSecret?, authorEmail?, fetch?}`, from `TYPST_GITLAB_*` in
`main.ts`) holds the only GitLab token. Protocol (`src/features/collaboration/gitlab-protocol.ts`):

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
  (`src/features/versions/versions.ts`): "Save version" + commit-message popover + status line, and
  `ChangeTracking.setBases(…, path → base of path)` on every base change, so "Changes since …"
  resets for everyone after a save, in every file.

### Demo playground (`demo/`, `server/src/playground`)

`mise run demo` = Vite + `server/src/fake-gitlab-main.ts` (plain rooms, and GitLab rooms against
an in-memory `FakeGitLab` holding `demo/examples/advanced`). Checklist with steps per feature:
[docs/demo-playground.md](docs/demo-playground.md).

- **State is the URL** (`demo/playground.ts`): `example`, `room` (none → Local, `gitlab:…` →
  GitLab, else Collaborate), `user` (put into the URL in a room, default Ann; the bar's second
  window link uses the next name). "Changes since opened" is the widget's own default (no
  `?changes` any more). `editorOptions(state, server)` → `files` / `collaboration`: GitLab mode passes no local files; no server →
  the local example.
- **Local mode never contacts a server**, so the static e2e build needs none. The room modes
  first `probeServer()` (`GET /playground` with CORS → `gitlab`; else an opaque `no-cors` request
  → `plain`; else `offline`) and re-probe every 5 s for the bar's status (`lost`, `reload`).
- **Dev-only endpoints** (`PlaygroundEndpoints`, a Hocuspocus extension added through
  `CollabOptions.extensions`; never loaded by `server/src/main.ts`): `GET /playground` →
  `{project, room}`; `POST /playground/upstream?room=gitlab:<project>@<branch>&change=append|heading`
  commits `upstreamEdit(…)` of one file (`appendTo`, here `chapters/introduction.typ`) to the
  fake branch, then hands a push-webhook request (random per-process secret) to the
  `GitLabExtension` found on the Hocuspocus instance, so open rooms merge it or report a
  conflict exactly as with a real push.

## Build and test

| Task | What it does |
|---|---|
| `mise run build:engine` | `cargo build --target wasm32-unknown-unknown --release` + `wasm-bindgen --target web` + `wasm-opt -Oz --strip-debug` → `src/core/typst-engine/wasm/`, prints raw/gzip/brotli size (skipped when the Rust sources are unchanged) |
| `mise run build:fonts` | default fonts from the pinned typst-assets crate → `src/core/typst-engine/fonts/` |
| `mise run fixtures:packages` | packs `src/core/typst-engine/fixtures/<name>-<version>/` into `.tar.gz` (committed) for package tests |
| `mise run demo` | the playground: Vite (127.0.0.1:5199) + collaboration server with the in-memory fake GitLab (ws://127.0.0.1:1234); Ctrl-C stops both. Feature checklist: [docs/demo-playground.md](docs/demo-playground.md) |
| `mise run dev` | Vite dev server for `demo/` on 127.0.0.1:5199 (Local mode needs nothing else) |
| `mise run build` | engine + typecheck + static demo build → `dist/demo` |
| `mise run build:lib` | library build → `dist/lib`: bundled ESM, worker, wasm, d.ts (`vite.lib.config.ts`, `tsconfig.lib.json`) |
| `mise run test:unit` | vitest (node): engine against the real wasm, document model, projection round-trips, demo examples compile |
| `mise run test:e2e` | builds demo + lib, then Playwright against `dist/demo` and `examples/` (+ `dist/lib`), served through request interception (no port needed) |
| `mise run server:dev` | collaboration server on ws://127.0.0.1:1234 (SQLite in `server/.data/`; env `PORT`, `TYPST_COLLAB_DB`, `TYPST_COLLAB_TOKEN`; GitLab rooms with `TYPST_GITLAB_URL` + `TYPST_GITLAB_TOKEN`, see docs/embedding.md) |
| `mise run server:test` | server tests (vitest, Hocuspocus in-process via `openDirectConnection`, no port) |
| `mise run test:e2e-collab` | starts the server in memory, then the two-user Playwright spec (`tests/e2e/collab.spec.ts`; skipped by `test:e2e`) |
| `mise run server:dev-fake-gitlab` | the playground server alone: plain rooms + GitLab rooms against an in-memory fake GitLab (`gitlab:demo/report@<any branch>`, the advanced example), playground endpoints |
| `mise run test:e2e-gitlab` | starts that server, then the GitLab room Playwright spec (`tests/e2e/gitlab.spec.ts`; skipped by `test:e2e`) |
| `mise run quality` / `quality:report` | complexity gate, folder boundaries (ESLint `local/entry-imports`), top comments (`quality:top-comments`); hot-spot table (see `.claude/skills/code-quality`) |

**Version pins** are all exact:
- Typst 0.15.1: the Rust crates and the CLI in `mise.toml`.
- wasm-bindgen 0.2.129: the crate and the CLI must match.
- binaryen (wasm-opt) 133.
- Rust 1.99.0, Node 24.21.0, pnpm 10.34.6.
- Yjs 13.6.33, y-protocols 1.0.7, Hocuspocus (server, provider, extension-sqlite) 4.7.0,
  node-diff3 3.2.1 (server).

## Known limitations / next steps

- **wasm is 23.1 MB raw (9.0 MB gzip, 6.6 MB brotli)**, down from 43 MB (15.8 / 10.6); PDF export
  (typst-pdf) is 1.9 MB raw / 0.66 MB gzip of it. The rest is
  code (11.7 MB: typst-library 2.7, plus wasmi for plugins, hayro for PDF images, citation/
  hayagriva, image codecs, usvg, serde_yaml/toml/xml loaders) and data (9.4 MB: ICU, syntect
  syntaxes via two-face, hayagriva styles, hyphenation tries). None of it is feature-gated in
  typst 0.15.1, so going further needs a typst fork. `opt-level = "z"` saves another 1.9 MB but
  compiles ~40 % slower, so the crate stays at `"s"`.
- **All 17 default fonts (9.7 MB, 6.4 MB gzip) load before the first render.** Next step: lazy
  fonts — ship a JSON index of `FontInfo` so the `FontBook` is complete up front and fetch font
  data on first use (compile, see which fonts were missing, fetch, recompile).
- **Multi-file UI:** empty folders live only in the panel (the project has no folders); a
  folder rename / move / delete is one change per file and may stop half-way at a refusal. Dragging an
  image from the panel into the Source view does nothing yet (Visual view only). File links do not follow paths built at run time (variables, `+`).
- **Packages:** only `@preview` from packages.typst.org (no configurable registry, no `@local`);
  failed downloads are not retried until the worker restarts.
- **Snippets are cut from the compiled pages**, so they only appear after a successful compile,
  show only what lies on the first page the range draws on, and include whatever overlaps that
  rectangle (e.g. a float). Every raw box asks again after every compile (one `boxes` walk each),
  also while the Visual view is hidden. Tables with merged cells, `table.cell`, header arguments
  or `columns: (..)` stay raw boxes.
- **GitLab rooms:** conflicts are reported (status line), not highlighted in the views yet;
  an asset changed on both sides keeps the room's
  version and overwrites upstream on save; GitLab-side renames are seen as delete + create; no
  GitLab sign-in yet (the token check is the stub, the author's name comes from the client); the
  room's main file must exist in the repository (else the widget's empty main is committed).
  `{ doc }` mode has no versions.
- **Collaboration:** images and other non-`.typ` files are not shared (outside GitLab rooms). `{ doc }` mode needs the
  widget and the host on the same Yjs instance (`dist/lib` bundles its own Yjs). In `{ doc }`
  mode the host must pass a synced Y.Doc; with `{ url }` an unreachable server leaves the widget
  local. Presence in the file panel is re-resolved on presence changes only (not on
every edit of a file not shown). In the Visual view a caret inside hidden markup (delimiters,
markers, blank lines) is drawn at the visible spot before it (the end of the line it ends), so a
caret at the end of a line never jumps to the start of the next one.
