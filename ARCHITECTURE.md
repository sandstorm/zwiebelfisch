# Architecture

This is the technical companion to the product concept in
[docs/2026_10_10_concept.md](docs/2026_10_10_concept.md). It describes the code as it is. When the
code changes, update this file in the same commit.

## Repository layout

```
src/                        the widget (TypeScript); the most important API on top
  index.ts                  public API of the package (createTypstEditor, <typst-editor>, the extension API's types,
                            Disposable, EventEmitter, collaboration); registers <typst-editor>; the only re-exporting file
  typst-editor/             typst-editor.ts: createTypstEditor() — a Project in the workbench host with the built-in
                            extension list (or the host's list made from it) and the host's settings, scoped CSS of the hosts (typst-editor.css:
                            tokens, frame, views, toolbar; the extensions bring their own)
  testing/                  testing.ts: test helpers composing the built-in extensions (the Visual view's schema and
                            a view with the built-ins, configured from test options; edit / after / find /
                            expectPreciseMap); test-only: only `*.test.ts` files may import it, and it may import
                            anything
  typst-editor-element/     typst-editor-element.ts: <typst-editor> custom element (shadow DOM) around
                            createTypstEditor; inline-source.ts (source written inside the element → text)
  hosts/                    view hosts: mechanism + contribution points, no feature knowledge
    workbench/              the widget's frame and the extension API (workbench.ts: TypstExtension, ExtensionContext,
                            Workspace (settings), Workbench, Command, DocumentLinkProvider, FileDecorationProvider,
                            SourceControl, EditorMode, Memory; and WorkbenchHost, what createTypstEditor creates, which
                            adds its own layout CSS); layout/ (layout.ts +
                            layout.css: side panels with rail buttons, editing area, preview, status bar), editing-views/
                            (Visual/Source tabs, lazily one VisualView + SourceView per document), color-scheme/
                            (`data-scheme`), extension-host/ (activation), commands/ (commands, key bindings),
                            configuration/ (Configuration: declared settings, the host's values, changes),
                            custom-editors/ (CustomEditors: the editor of a non-Typst file by file name pattern and priority;
                            filename-pattern.ts: the globs), file-drops/ (files dropped on the widget), style-sheets/
                            (StyleSheets: the widget's and the extensions' CSS in its shadow root or head, shared and
                            reference-counted), document-links/ (DocumentLinks: the providers' links merged by
                            priority; link-extension.ts: links in a CodeMirror editor, the Source views' and raw
                            boxes'), file-decorations/ (FileDecorations), source-controls/ (SourceControls),
                            status-bar/ (StatusBar: the status bar items, left / right by priority),
                            menus/ (Menus: menu entries by menu id), notifications/ (Notifications: the messages),
                            quick-input/ (QuickInput: input box and quick pick)
    visual-view/            VisualView (Tiptap over the projection) and its contribution points, all in visual-view.ts:
                            VisualViewContributions, TypstNodeSpec / TypstMarkSpec, toolbar items and groups, box
                            renderers / tools / actions, gutters, highlights, VisualViewContext, svg, starterKitPart,
                            createSchema; nodes/ (the host's own nodes, the raw box), toolbar/, highlights.ts
    projection/             the source-anchored projection between Typst text and the Visual view's ProseMirror
                            document (projection.ts: project, print, syncDoc, the position maps, the spec contract
                            NodeGrammar / MarkGrammar / ProjectionContext / Printer); grammar.ts, projecting.ts,
                            printing.ts, labels.ts, pristine.ts. Not a view: the Visual view host's mechanism, a
                            module of its own so specs and tests reach it through its entry
    source-view/            source-view.ts, all of it: SourceViewHost (registerExtension, createView: what
                            `ExtensionContext.sourceView` is), the contribution types, `fromDocument`, and SourceView
                            (CodeMirror 6 bound to a TypstDocument)
    preview/                Preview — worker-backed live preview + hit-testing, scroll / reveal; what
                            `ExtensionContext.preview` is: toolbar items, PDF export options, page overlays (their types,
                            Zoom and Snippet are in preview.ts),
                            reveal / onDidClickPage, onDidChangeDiagnostics / onDidRender, snippet, exportPdf;
                            latest-only.ts ("only the newest value" task runner)
      worker/               worker.ts (startEngineWorker, main-thread side), engine.worker.ts (the worker),
                            protocol.ts (messages), project-files.ts (FileSender/FileReceiver)
      pages/                page-list (SVG only near the viewport), overlays, geometry, zoom, snippet
  stylesheets.test.ts       every .css under src/ parses (lightningcss, no error recovery), no nested style rules,
                            every block closed (an unclosed rule silently nests the rest of the file),
                            hex colors only in the color tokens (dark mode)
  core/                     the models everything builds on
    typst-document/         TypstDocument — the single source of truth (a string; no Yjs: collaboration binds a Y.Text
                            from outside); TextChange (the one edit format) and minimalChange, all in typst-document.ts
    typst-engine/           typed TS wrapper around the wasm (typst-engine.ts: createEngine, fetchFonts); generated
                            wasm/, fonts/ (gitignored)
    engine-assets/          the wasm + default font URLs for the main thread (a module of its own: the worker imports
                            typst-engine and must not bundle the assets again)
    typst-packages/         withPackages: Typst packages (@preview/…) downloaded on first use and added to an engine
                            (fetchPreviewPackage, tar.ts: the archive reader; fixtures/: the greet test package)
    paths/                  ProjectPath (where a file is) and PathReference (a path as written in Typst source),
                            branded strings with their operations: parse, fromName, resolve, referenceTo, isTypst
                            (the only kind core knows: Typst source or not), displayName, extension
    project/                Project: which files a project has and which changes are allowed (one TypstDocument
                            per .typ file, main protected); FileChange, FileContent, ProjectFiles. No re-exports.
    typst-syntax/           the Typst syntax several extensions need (Lezer): findFilePaths (the file paths a Typst text
                            names), readingOrder (main file, then its #includes depth first) and neighbours,
                            calculateImportChange (the change that imports a name from a module, once; applies
                            nothing: margin notes merge it into their own edit); what projectors and printers read
                            (children, parenthesized, isClosedContent, decodeString, quote, isEmbeddable)
    uploads/                uploadChanges: files from the computer (picked, dropped) as `create` changes at the top
                            of the project (`.typ` as text, the rest as bytes); used by files and images; takes any
                            `UploadedFile` (`name`, `text()`, `arrayBuffer()`: a DOM File is one, core names no DOM type)
    gitlab-protocol/        the rooms' Y.Doc map names (FILES_MAP, ASSETS_MAP, META_MAP) and GitLab rooms' messages
                            and file URLs: import-free, shared by collaboration and server/
    disposable/             Disposable (VS Code's shape: `new Disposable(fn)` disposes once; `Disposable.from(...)` in
                            reverse order)
    event-emitter/          EventEmitter<T> (`event` to subscribe, `fire`), Event<T>
  ui/                       feature-neutral DOM widgets, one folder each: popup-menu/ (PopupMenu: a role=menu at a
                            point or below a button, e.g. the file panel's menus), toolbar-menu/ (ToolbarMenu: a menu
                            button of toolbar buttons), floating-bar/ (FloatingBar: a bar above an anchor in the text),
                            color-scheme/ (isLightText: light or dark, from a resolved text color; textColorOn: black
                            or white text on a color)
  extensions/               one vertical slice per concept (docs/2026_10_10_extensions-architecture.md): <name>.ts
                            (the entry: the TypstExtension factory, the controller), model/ (pure, no DOM), and one
                            folder per host it contributes to (workbench/, preview/, visual-view/, …), which have no
                            entry files: the extension's files import each other directly. Extensions never import
                            each other.
    files/                  files (the file panel in a side panel; the commands files.newFile / newFolder / upload /
                            rename / delete in the menus file/newFile and explorer/context), fileNavigation (editor
                            frame); files.css (each extension with styles has its <name>.css, registered with
                            Workbench.registerStyleSheet)
      model/                tree-model.ts (the tree as data, keyboard moves, relocate)
      workbench/            file-panel.ts (FilePanel: header with "New", its menus, the operations, uploads), file-navigation.ts ("← previous file"
                            / "next file →"), tree/ (FileTree: rows, keyboard, drag & drop, file decorations as
                            badges), icons/ (leaf)
    spreadsheets/           spreadsheets: the `.ic` custom editor; every edit also stores `name.ic.gen.typ`; "New spreadsheet…"
      model/                typst-file.ts (spreadsheetTypst → name.ic.gen.typ for Typst, typstPath), dark-theme.ts
                            (darkThemeVariables: IronCalc's palette from the widget's tokens)
      workbench/            spreadsheet-view.ts (SpreadsheetView), workbook.ts (React + IronCalc, loaded on demand),
                            color-scheme.ts (followColorScheme: the dark palette while data-scheme is dark)
    diagrams/               diagrams(): `.drawio.png` in diagrams.net's embedded editor (the custom editor diagrams.editor,
                            auto-save), "New diagram…", "Edit diagram" on boxes showing one; diagrams.css
      model/                embed-session.ts (EmbedSession: the embed protocol as pure state; embedUrl), png.ts (the
                            diagram's XML in a PNG's tEXt chunk, data URIs), empty-diagram.ts
      workbench/            diagram-editor.ts (DiagramEditor: the iframe, scheme, offline), new-diagram.ts
      visual-view/          editDiagramAction (a box action)
    source-control/         sourceControl(): the UI over the workbench's source controls: "Save to <label>…" in the
                            tab bar (menu editor/title, command sourceControl.commit)
      workbench/            commit (the commit message in the input box), tellStatus (outcomes and news as messages)
    pdf-export/             pdfExport: the `pdfExport.export` command (PdfExport: the project's PDF, with every
                            registered export option applied) and the preview's "Download PDF" with its options popover
      preview/              preview.ts (downloadPdf: "Download PDF" + popover: a checkbox per option, "Download";
                            no PDF: an error message)
    preview-controls/       previewControls: the preview toolbar's zoom and page number
      model/                zoom.ts (stepZoom over the presets, zoomText / zoomLabel)
      preview/              zoom-controls.ts (zoomControls), page-number.ts (pageNumber)
    preview-sync/           previewSync: the preview follows the cursor ("Follow cursor", remembered in localStorage),
                            a click in it selects the source; preview/ (followCursor: the switch)
    images/                 images(): image boxes + figures, "Insert image", ProjectImages (object URLs, uploads);
                            imagesVisualView (its options, ImageAssets / ImageUrls / ImageLinks: the test seam
                            testing/ uses), all in images.ts;
                            model/ (image-call.ts: arguments edited in place; upload.ts: uploadTarget),
                            visual-view/ (specs, tools, insertion, image-path-link: the path's document link),
                            model/image-files.ts (isImage, imageBlob: the media types), workbench/ (AssetView: images and other
                            files read-only, the custom editors `images.preview` and `images.file`)
    rendered-boxes/         renderedBoxes() and renderedBoxesVisualView({ snippets }): raw boxes drawn as snippets
                            from the preview; model/ (Snippet, rendersInPlace, inlinePictureSize, snippetSize),
                            visual-view/ (the box renderer)
    document-links/         documentLinks(): a DocumentLinkProvider: file paths as links (open, or create a missing .typ)
    typst-language/         typstLanguage(): Typst syntax + code colors in the Source views and raw boxes;
                            source-view/ (typst-syntax.ts, code-colors.ts)
    comments/               comments.ts (comments({ user })); model/ (margin-note-syntax.ts: drafting's call, parse,
                            print, validity; note-thread.ts: a note's body as a thread of messages; add-margin-note.ts,
                            page-margin.ts, without-notes.ts: the sources without comments; card-layout.ts);
                            visual-view/ (marginNotes: notes in the text + the Comment action; notes-gutter/: the cards);
                            workbench/ (CommentAction, the command comments.addComment, Ctrl+Alt+M, its editor/title
                            entry in the Source tab); preview/
                            (registerIncludeComments: the PDF export option `comments.include`)
    collaboration/          collaboration.ts (eager: the extension), collaboration-link.ts (CollaborationLink: loads
                            model/ on demand), remote-origin.ts (REMOTE_ORIGIN, eager); presence/ (Presence,
                            PlacedPresence, Presences: everyone's places, eager);
                            model/ (the lazily loaded chunk: Collaboration, SharedProject, TextBinding (+ y-delta.ts),
                            SharedAssets, RemoteCursors,
                            GitLabSourceControl (the protocol: core/gitlab-protocol); in-process.ts, Y.Doc/awareness
                            wiring for tests); source-view/ and visual-view/ (drawing the other users' carets and
                            selections, also in raw boxes; perUserUndo: their edits out of the Source views'
                            undo history); workbench/ (presenceDecorations: who is in which file)
    diagnostics/            diagnostics.ts (the extension); model/ (DiagnosticCollection, describeDiagnostic,
                            diagnostics-summary.ts); source-view/ (lint); visual-view/ (diagnosticHighlight); workbench/
                            (DiagnosticsStatus: the status bar item)
    markup/                 strong, emphasis, links, raw text (inline code, code blocks; model: raw-code), quotes
    headings/               headings and their numbers (model: numbering patterns, HeadingCounter, the rules' code)
    lists/                  bulleted, numbered and task lists (model: cheq's preamble, calculateChecklistPreambleChange; cheq.test.ts compiles task lists with the cheq fixture)
    tables/                 `#table(..)` as a table, Insert table, the table bar (model: TableLayout)
    page-layout/            page breaks and horizontal rules
    alignment/              `#align(..)[..]`, `#par(justify: ..)[..]`, the Align menu (model: alignment syntax)
    outline/                the table of contents (`#outline(..)`)
    labels/                 labels(): model/ (LabelIndex: the project's labels and reference counts; scan.ts (Lezer, .bib); reference syntax, label names, the @ list's choices);
                            visual-view/ (reference chips + hints, label tags, the @ list, "Add label")
    styles/                 styles(): model/ (StyleIndex: the custom styles the project declares (`/// @style …`),
                            how a document imports one; discover.ts, new-style.ts);
                            visual-view/ (styled block + style mark, the text style menu); "New style…"
crates/typst-engine/        Rust → wasm: Typst compiler, SVG and PDF export, click/cursor jumps
  src/world.rs              in-memory Typst World (files and fonts pushed from JS)
  src/lib.rs                wasm-bindgen interface (JSON in/out, UTF-16 offsets)
server/                     collaboration server (Node package, Hocuspocus; TypeScript run by Node directly)
  src/gitlab/               GitLab-backed rooms: GitLabExtension, GitLabRoom, GitLabProject (REST), merge, commit actions,
                            HTTP endpoints, FakeGitLab (in-process, for tests and server:dev-fake-gitlab)
  src/playground/           dev-only: playgroundOptions (fake GitLab with the advanced example + webhook),
                            PlaygroundEndpoints (GET /playground, POST /playground/upstream), readProjectFiles
demo/                       the playground (vite root; checklist: docs/demo-playground.md); ?example=hello|simple|advanced
                            picks a project from demo/examples/<name>/ (examples.ts: import.meta.glob → file map;
                            the advanced example's data/compile-times.ic comes from mise run fixtures:demo-spreadsheet);
                            playground.ts (URL ↔ state: example, room → Local/Collaborate/GitLab mode, user),
                            server-status.ts (probe ws://127.0.0.1:1234, simulate upstream), playground-bar.ts (the bar)
examples/plain-html/        <typst-editor> loaded from dist/lib without a bundler
tests/e2e/                  Playwright specs (run against the static build); tests/jsdom-setup.ts (vitest setup file)
eslint-rules/               the ESLint rules of the folder rules (below): entry-imports.js, no-re-exports.js,
                            dependencies.js (the layers), imports.js (what they share)
mise-tasks/                 every script (build, test, quality, …) — `mise tasks ls`
docs/                       research and concepts (YYYY_MM_DD_slug.md)
```

### Folder rules

All checked by `mise run quality` (ESLint with the rules in `eslint-rules/`, configured in `eslint.config.js`;
`quality:top-comments`; `quality:module-cycles`). The exceptions are listed there, each with its reason, and should
shrink, not grow.

- **Modules.** The module boundary is the core / host / extension / ui folder, not every folder: `core/<name>/`,
  `hosts/<name>/`, `extensions/<name>/`, `ui/<name>/`, and `typst-editor/`, `typst-editor-element/`, `testing/`.
  `core/`, `hosts/`, `extensions/` and `ui/` only group. A module has one entry file, inside its folder (no sibling
  folders), named after the folder where that reads well (all are today: `preview/preview.ts`; a stylesheet may be
  `files/files.css`). `src/index.ts` is the package's entry.
- **The entry defines the API.** What other modules use is declared in the entry, the most important part at the
  top, under a top comment that says why the module exists. The internal files hold the implementation; they import
  the API's types from the entry (`../visual-view`) and are never forwarded.
- **No re-exports** (`local/no-re-exports`): a file exports only what it defines. `export … from`, `export *` and
  exporting an imported name are errors everywhere but `src/index.ts`, which gathers the public API
  (`reExportExceptions`). An outside caller that needs an internal name is a sign that the code belongs in the
  entry, or that the concept is a module of its own (as `core/typst-packages`, `core/engine-assets` and
  `hosts/projection` became).
- **Inside a module everything is open.** Layer and concept subfolders (`model/`, `visual-view/`, `nodes/`,
  `worker/`; never generic ones like `utils/` or `impl/`) have no entry files of their own: files import each other
  directly (`./model/label-index`). A file named like its subfolder (`visual-view/visual-view.ts`) is no entry,
  just the subfolder's main file.
- **From outside a module, only its entry** (`local/entry-imports`). Only TypeScript and CSS sources count (not the
  generated `wasm/`, `fonts/` or the `fixtures/`). Exceptions (`boundaries.exceptions`): the server's tests import
  `extensions/collaboration/model/shared-project.ts` and `in-process.ts` to build rooms from the client's
  SharedProject, wired in-process.
- **Layers** (`local/dependencies` on resolved files, the list `layers`; package imports with
  `no-restricted-imports`; the DOM with `no-restricted-globals` and `@typescript-eslint/no-restricted-types`; tests
  included; see docs/2026_10_10_extensions-architecture.md, "Dependency rules"):

  | Files | May not import / use |
  |---|---|
  | `core/**` | anything outside `core/`; Yjs (`yjs`, `y-*`, `@hocuspocus/*`); editor libraries; the DOM |
  | `extensions/<name>/model/**` | editor libraries (`@tiptap/*`, `prosemirror-*`, `@codemirror/*`, `codemirror`); the DOM; the extension's view folders (`visual-view/`, `source-view/`, `preview/`, `workbench/`); `hosts/`, `ui/` |
  | `ui/**` | `hosts/`, `extensions/`, `typst-editor/`, `typst-editor-element/` |
  | `hosts/**` | `extensions/`, `typst-editor/`, `typst-editor-element/`, `testing/` (a host's tests use its own nodes and specs) |
  | `extensions/<a>/**` | `extensions/<b>/` (extensions meet through core models or a host's generic contribution point) |
  | anything but `*.test.ts` and `testing/` | `testing/` |

  The DOM means its globals as values and as types (`window`, `document`, `HTMLElement`, `File`, …; `fetch`,
  `Blob` and streams are no DOM, workers have them). Tests of the built-ins together (the projection's fixtures, the
  toolbar's items, the block nodes) are the widget's, `typst-editor/typst-editor.*.test.ts`; an extension's tests
  needing other extensions (a heading to put a label on) take them from `testing/`, never from the other extension.
- **No cycles between modules** (`mise run quality:module-cycles`): type imports count, tests do not (an
  extension's tests use `testing/`, which composes the extensions). Cycles inside a module are its own business
  (the Visual view's entry and its `nodes/` and `toolbar/` import each other).
- **Top comments.** Every source file starts with a comment: its context, `See <entry file /
  ARCHITECTURE.md section>`, or `Tests for X` (`mise run quality:top-comments`).
- Other languages and separate programs stay at the top level: `crates/`, `server/`, `demo/`,
  `examples/`.

## Runtime picture

```
 main thread                                                    worker thread
┌──────────────────────────────────────────────────────────┐   ┌────────────────────────┐
│ createTypstEditor(host, { files })  (preview-sync: the   │   │ engine.worker.ts       │
│   arrows between the views and the preview)              │   │                        │
│                                                          │   │                        │
│  ┌──────────────┐ change(edits, origin) ┌──────────────┐ │   │  ┌──────────────────┐  │
│  │  SourceView  │──────────────────────►│TypstDocument │ │   │  │  Engine (wasm)   │  │
│  │ (CodeMirror) │◄──────────────────────│  text        │ │   │  │  MemoryWorld     │  │
│  └──────┬───────┘   onDidChange({      └──────┬───────┘ │   │  │  last document   │  │
│         │ ▲    contentChanges, origin}) │         │   │  │  svg cache       │  │
│ selected│ │reveal(from,to)                     │ text    │   │  └──────────────────┘  │
│         ▼ │                                    ▼         │   │           ▲            │
│  ┌──────────────────────────────────────────────────┐    │   │           │            │
│  │ Preview                                          │ postMessage        │            │
│  │  update(files) → coalesce → compile ─────────────┼────┼──►│ compile ──┘            │
│  │  pages ◄── swap only pages whose hash changed ◄──┼────┼───│ {pages, diagnostics}   │
│  │  click (px→pt) ──────────────────────────────────┼────┼──►│ jumpFromClick          │
│  │  onDidClickPage(from,to) ◄───────────────────────┼────┼───│ {kind:'source',…}      │
│  │  reveal(path,from,to) ───────────────────────────┼────┼──►│ jumpFromCursor         │
│  │  scroll to      ◄────────────────────────────────┼────┼───│ [{page,x,y}]           │
│  └──────────────────────────────────────────────────┘    │   └────────────────────────┘
└──────────────────────────────────────────────────────────┘
```

## Modules and their contracts

### `createTypstEditor` / `<typst-editor>` (`src/typst-editor/`, `src/typst-editor-element/`, `src/index.ts`)

```ts
createTypstEditor(host, { files?, main?, source?, mode?, allowFileChange?, onFilesChange?, onOpen?, user?,
                           settings?: { [id]: value }, extensions?(builtins) → TypstExtension[] })
  → { files (get/set), source (get/set), settings (get/set), activeFile, open(path),
      executeCommand<T>(id, ...args) → Promise<T>, exportPdf({options?}) → Promise<Blob>, destroy() }
<typst-editor value="…" settings='{"pdfExport.download": false}'>
  .options (Partial<TypstEditorOptions>), .value, .files, .settings, executeCommand(id, ...args), exportPdf({options?});
  'change' {detail:{path, content}}, 'files-change' {detail: FileChange}, 'open' {detail:{path}}
```

- **One mechanism for all files.** `files` (`ProjectFiles = Record<path, string | Uint8Array>`) are
  *all* the project's files, the main file (`main`, default `/main.typ`) included — as option, getter
  and setter; `onFilesChange` reports every change to any of them. Assigning `files` replaces them
  (`Project.replace`: documents of paths that stay are kept and get the new text as one edit; the
  main file cannot be deleted, so without an entry it keeps its text) and recompiles. `source` is
  only a shortcut for the main file's text (as option it wins over `files[main]`; assigning it is an
  `update` of the main file). `@preview` packages need no entry.
- **`<typst-editor>`** is a thin generic adapter (decided 2026-10-10): a shadow root and `createTypstEditor`. It
  spreads its `options` property in when it connects (no per-option properties or attributes: a new option or
  setting needs no change there); one `settings` attribute (a JSON object, over `options.settings` id by id, read
  again when it changes; not an object: ignored with a warning) and the `settings` property map onto the settings;
  the editor's callbacks become DOM events from one table (`EVENTS`: `onFilesChange` → `files-change` + a
  `change` per file, `onOpen` → `open`), the host's own callbacks are called as well. The `value` attribute and
  the text content give the main file's text. `options` / `value` / `files` / `settings` set before the element
  is defined are picked up on upgrade. `value` / `files` are the live content; setting them dispatches nothing.
  `change` fires per file whose content changed (`TypstEditorChangeDetail = { path: ProjectPath, content:
  FileContent | null }`, null: gone; a rename is two), `files-change` with every `FileChange`.
- **Composition**: a `Project` in a `WorkbenchHost` (`hosts/workbench`, see "Extensions" below) that runs the
  built-in extension list (`builtinExtensions`, none configured: what a feature lets hosts configure is a setting
  it declares): `typstLanguage`, `documentLinks`, `files`, `fileNavigation`, `spreadsheets`, `diagrams`, `diagnostics`,
  `sourceControl`; the Visual view's constructs and features: `markup`, `headings` (with their numbers),
  `tables`, `images`, `renderedBoxes`, `outline`, `pageLayout`, `lists`, `alignment`, `comments`, `labels`,
  `styles`; then `previewSync`, `previewControls` and `pdfExport`. Extensions never depend on each other, so the
  order carries no meaning: where the Visual view's contributions compete, or document links overlap, `priority`
  decides (see "VisualView"; tested by projecting every fixture with the built-ins in reverse order); toolbar items
  and menu entries (also the tab bar's) have `group` + `order`, status bar items `alignment` + `priority`. `typst-editor.ts` names
  no feature: no per-feature option, only `exportPdf` (a documented shortcut for the command `pdfExport.export`).
- **Public extension API** (decided 2026-10-10): `extensions(builtins) → list` makes the list from the built-ins
  (default: them): add the host's own, leave one out or replace it by `id`. A function rather than an array, so
  "add one" cannot be mistaken for "replace all", and neither the built-in list nor each factory has to be
  exported. `collaboration` is not a built-in: it needs the host's connection (a Y.Doc or a server), so the host
  adds `collaboration({ url, room })` (exported from `src/index.ts`). The extension API's types (also those of
  messages, input box, quick pick and menus: `MessageItem`, `InputBoxOptions`, `QuickPickItem`, `QuickPickOptions`,
  `MenuItem`, `MenuContext`), `Disposable`, `EventEmitter`, `Event` and `ProjectPath` (with `parse` / `of`: the
  API takes parsed paths) are exported from `src/index.ts`, the only file that re-exports.
- **Widget options vs. settings** (decided 2026-10-10): the content and the host integration are options (`files`,
  `main`, `source`, `mode` (where to start), `allowFileChange`, `onFilesChange`, `onOpen`, `user`); what a feature
  lets hosts configure is a setting its extension declares, changeable later through `editor.settings`:
  `pdfExport.download` (was `pdfDownload`), `files.panel` (was `fileList`), `previewSync.followCursor` (was
  `followCursor`), and the workbench's own `workbench.theme` (was `theme`). `user` stays an option: several
  extensions read it (`Workbench.user`: comments sign with it, collaboration shows and commits with it), so it is
  no one extension's setting. The preview always compiles `main` with `project.files()`; `onFilesChange` hears a
  change after the workbench and the extensions.
- **Diagnostics**: the preview's `onDidChangeDiagnostics` is the one source. The `diagnostics` extension puts
  each document's into a `DiagnosticCollection`, which its Source views underline (`lint`) and its Visual views
  mark (`registerHighlights('diagnostics', …)`: `.typst-diagnostic` with the message as tooltip; an empty range
  still marks one character), and counts them in the status bar.
- **`Project`** (`core/project/project.ts`): files by path. `.typ` strings become a `TypstDocument` each (kept
  across renames, so open views survive); everything else is stored as given.
  `check(change)` → reason or null, `apply(change)`, `replace(files)`, `onDidChangeFile: Event<FileChange>`
  (structural changes and every document edit as `update`; `replace` reports a `delete`, `create`
  or `update` per file, so subscribers never need to be refreshed by hand). The main file cannot be renamed or
  deleted; `.typ` files keep their ending.
  `FileChange = {kind:'create', path, content} | {kind:'update', path, content} | {kind:'delete', path} | {kind:'rename', from, path}`.
- **Visual view contributions**: the workbench host has one `VisualViewContributions` (`ExtensionContext.visualView`)
  and makes every document's Visual view from it. The Typst constructs (`markup`, `headings`, `tables`,
  `outline`, `pageLayout`, `lists`, `alignment`) are extensions in `extensions/<name>/`; the features activate
  theirs with what they own:
  `images` → `imagesVisualView`, `renderedBoxes` → `renderedBoxesVisualView`,
  `typstLanguage` → the raw boxes' syntax and colors (`registerBoxCodeExtension`), `comments` → `marginNotes` +
  `notesGutter`, `labels` → `references`, `styles` → `customStyles`. The list's order is the schema's.
- **`EditingViews`** (`hosts/workbench/editing-views/`): one Visual/Source tab bar; a document's views are
  created the first time it is shown and then only hidden, so cursor and undo history survive switching. The
  mode is shared. With a single file the DOM is the same as before (tabs + two panes). Per document a
  `DocumentEditor` (`Workbench.activeTextEditor`, a `TextEditor`) stands for both views: `selection` and
  `revealRange` use the current tab.
  `setFrame({ top, bottom })` (`Workbench.registerEditorFrame`) keeps two elements first and last in the
  visible pane (they scroll with the file). The `fileNavigation` extension puts `FileNavigation` there: for a
  file the main file `#include`s
  (`neighbours(read, main, path)` from `core/typst-syntax`, recomputed on open and every change),
  links to the file read before it and the one after it, both at the top and at the bottom;
  nothing for the main file or files outside the include order.
- **`FilePanel`** (see "File panel" below; the `files` extension) lives in the side panel `files`: open by
  default when the setting `files.panel` is `show`, or `auto` with more than one file; `hide` removes it with its
  rail button (all three follow a change of the setting). A requested change goes through `Workbench.applyChange`: `project.check`, then the host's
  `allowFileChange` (async allowed; re-checked afterwards), then it is applied. Files dropped anywhere on
  the widget (`Workbench.onDidDropFiles`) are uploaded unless `files.panel` is `hide` (then ignored) — never
  left to the browser, which would open the file in place of the page (the workbench prevents that, also
  while nobody listens). Image files dropped into the Visual view's text are taken
  there instead (uploaded and inserted at the drop point).
- **File links** (see below): the `documentLinks` extension registers one `DocumentLinkProvider` with the
  workbench (paths resolve from the file's path; a link opens its file with `Workbench.open`; a missing `.typ`
  file's link offers "Create …": the command `documentLinks.createFile(path)`, a `create` change through
  `applyChange`, then `open`). The workbench shows the
  links of every provider in the Source views and the raw boxes' code; `images` shows an image box's path as its
  link (`Workbench.provideDocumentLinks` / `resolveDocumentLink`).
- **Preview sync** (the `previewSync` extension): a click in the preview selects its source (another project
  file is opened first; clicks into packages are ignored), and while "Follow cursor" is on the preview scrolls to
  the selection the user moves (the setting `previewSync.followCursor` if the host set it, else the viewer's last
  choice, else on). Without the extension the preview neither follows nor jumps.
- **Images and rendered boxes** (`extensions/images`, `extensions/rendered-boxes`): `ProjectImages` (the `images`
  extension) gives every document's Visual view its `ImageUrls` (image files resolved like Typst
  (`ProjectPath.resolve`) and shown as object URLs, made once per content and revoked when replaced; refreshed on
  `Preview.onDidRender`) and `ImageAssets` (the project's images as `PathReference`s (`ProjectPath.referenceTo`);
  uploads become a `create` change (`uploadChanges` of `core/uploads`, `uploadTarget` in `model/`) that goes through `allowFileChange`
  like the file panel's; an upload equal to an existing file (`name.png`, `name-2.png`, …) reuses it, a different
  one gets the first free of those names — every pasted screenshot is `image.png`; refusals — not an image Typst
  shows, the host's veto — come back as an error, shown as an error message). The `renderedBoxes` extension gives each
  document's raw boxes their snippets: `Preview.snippet` under the document's current path, refreshed on
  `Preview.onDidRender`.
- **PDF**: one "Download PDF" button with an options popover, no button or menu entry per variant (decided
  2026-10-10). Any extension offers a choice through the preview host:
  `preview.registerPdfExportOption({ id: '<ext>.<name>', label, description?, default, apply(entry, value) → entry },
  { priority? })` — checkboxes for now (`choices` can come later). The `pdfExport` extension
  (`extensions/pdf-export/`) is the policy: `PdfExport` / the command `pdfExport.export(options?)` starts from
  `{ main, sources: {} }` and lets every registered option change it in turn (by `priority`, default 100, higher
  first; equal: registration order), each with its value (given, else its default; an unknown id rejects), then
  compiles that entry; the toolbar item (`downloadPdf`, while the setting `pdfExport.download` is on) opens a popover with a
  checkbox per option, set as this viewer left them (`workbench.remember('pdf-export.options')`) else their
  default, and "Download"; without any option the button downloads at once. `exportPdf({ options })` on the
  widget runs the command (defaults, not the viewer's choices). The `comments` extension registers only
  `comments.include` (default off; `extensions/comments/preview/`): off, `withoutNotes` of the project's files
  overlaid with the entry's sources gives the new entry (see Comments); on, the entry stays. No PDF (errors) →
  an `Error` "The document has n error(s): …" (the button shows it as an error message "No PDF: …"; while a PDF
  is being made it says "Making PDF…" and is disabled), never an older PDF. File name after the
  main file: `main.pdf`.
- **Images into the text**: `AssetView` (the `images` extension's custom editors of images and other files) only previews. An image row dragged from the file panel
  (drag type `PROJECT_PATH_TYPE` from the workbench host, data: the project path) and dropped on the Visual view is
  inserted there as an image block (`imageFileDrops` → `ImageAssets.reference(path)`: relative
  when in the same folder tree, else project-absolute; not for non-images).

- Setting `source`/`value` applies **one minimal edit**: only the range between the common prefix
  and the common suffix changes (`minimalChange`), so cursors and undo history are preserved.
- **Styles** go into `host.getRootNode()`: `document.head`, or the element's shadow root.
  CodeMirror mounts its own styles into the same root. Embedding guide: [docs/embedding.md](docs/embedding.md).

### Extensions (`src/hosts/workbench`)

```ts
interface TypstExtension {
  id; activate(context: ExtensionContext): void
  contributes?: { configuration?: { properties: { [id: '<section>.<key>']: ConfigurationProperty } } }
}                                       // ConfigurationProperty { type (or types), default, description, enum? }
interface ExtensionContext {
  subscriptions: { dispose() }[]        // disposed on destroy: extensions in reverse list order, each in reverse
  project: Project
  workspace: Workspace                  // getConfiguration(section?) → { get(key, default?), has(key), inspect(key) },
                                        // onDidChangeConfiguration: Event<{ affectsConfiguration(section) }>
  workbench: Workbench                  // the frame's contribution points (below)
  visualView: VisualViewContributions   // registerNode, registerMark, registerToolbarGroup / Item, registerGutter,
                                        // registerBoxRenderer, registerEditorExtension, … (see "VisualView")
  sourceView: SourceViewContributions   // registerExtension(cm | context → cm) (see "SourceView")
  preview: PreviewContributions         // registerToolbarItem, registerPdfExportOption, createOverlay, reveal, onDidClickPage,
                                        // onDidChangeDiagnostics, onDidRender, snippet, exportPdf (see "Preview")
}
interface Workbench {
  ownerDocument; activeFile; user?: { name, color? }; open(path, { selection?, mode?, viewType? }); onDidShowFile
  applyChange(change) → reason | null
  registerSidePanel(id, { label, icon }) → SidePanel { body, setDefault, setAvailable, dismiss, dispose }
  registerStatusBarItem(element, { alignment: 'left' | 'right', priority? })   // VS Code's StatusBarItem: higher priority
                                    // further left within its side (default 0), equal: registration order
  registerEditorFrame({ top, bottom })
  registerStyleSheet(css)           // the extension's CSS where the widget renders (head or shadow root)
  registerCustomEditorProvider(viewType, { resolveCustomEditor(document: { path, content }, panel: { element, onDidDispose }) },
                               { filenamePattern: '*.drawio.png', priority?: 'default' | 'option' | number })
  registerCommand(id: string, handler(...args))  executeCommand<T>(id, ...args) → Promise<T>
  registerKeybinding('Mod+Alt+KeyM', id)
  onDidDropFiles  remember(name) → Memory
  showInformationMessage / showWarningMessage / showErrorMessage(message, ...items: (string | { title })[])
                                    // → Promise<item | undefined>
  showInputBox({ title?, value?, valueSelection?, prompt?, placeHolder?, validateInput?(value) → message }) → Promise<string | undefined>
  showQuickPick(items: (string | { label, description?, detail?, picked? })[] | Promise<…>, { title?, placeHolder?, canPickMany? })
                                    // → Promise<item | undefined>, with canPickMany Promise<item[] | undefined>
  registerMenuItem(menuId, { command, title?, icon?, when?(context) → boolean, group?, order? })
  getMenuItems(menuId, context?) → MenuItem[]   onDidChangeMenu: Event<menuId>
  registerFileDecorationProvider({ provideFileDecoration(path) → FileDecoration | FileDecoration[] | undefined,
                                   onDidChangeFileDecorations })   getFileDecorations(path)   onDidChangeFileDecorations
                                    // FileDecoration { badge?, tooltip?, color?, propagate? }
  registerDocumentLinkProvider({ provideDocumentLinks(document: TextDocument { path, text }) → DocumentLink[],
                                 resolveDocumentLink?(link) → DocumentLink }, { priority? })
  provideDocumentLinks(document) → DocumentLink[]   resolveDocumentLink(link) → DocumentLink
                                    // DocumentLink { range: {from, to}, target?: ProjectPath, tooltip?,
                                    //                command?: Command { title, command: id, arguments? } }
  registerSourceControl({ id, label, defaultCommitMessage?, state: { busy, status: { message, severity } | null },
                          onDidChange, commit(message) })
  sourceControls   onDidChangeSourceControls
  activeTextEditor: TextEditor | null  onDidChangeTextEditorSelection: Event<{ textEditor }>  isEditorFocused()
}
interface TextEditor {   // a Typst file's Visual + Source views (one per document)
  document; mode   // the tab the user works in
  selection        // {from, to} in that tab's view
  revealRange(from, to)
}
new WorkbenchHost(host, project, { mode?, user?, settings?, allowFileChange?, onOpen?, styleSheet? })
  .activate(extensions)  .settings (get/set)  .destroy()      // + everything of Workbench
```

- **Why.** The frame knows no feature by name (review finding `typst-editor.ts:170`): a feature is a
  `TypstExtension` that registers its contributions once, at activation, and pushes the registrations into
  `subscriptions`. VS Code's vocabulary: `register…` returns a `Disposable` (`core/disposable`), events are
  `onDid…` (`Event<T>` from `EventEmitter`, `core/event-emitter`), everywhere: core's models (`Project.onDidChangeFile`,
  `TypstDocument.onDidChange`), the hosts and the extensions; subscribing returns a `Disposable`, never an
  unsubscribe function.
- **Lifecycle.** The workbench host makes its view hosts first: `VisualViewContributions` and a `SourceViewHost`
  (both handed to `EditingViews`) and the `Preview`; they are the context's `visualView`, `sourceView` and
  `preview`. `WorkbenchHost.activate(list)`: first every extension's declared settings
  (`contributes.configuration`, so an extension may read any declared setting during activation; values for
  undeclared settings are reported with a console warning and ignored), then the
  extensions in list order (`ExtensionHost`, ids unique), then the main file is shown and compiled. Views are created later, lazily, with what was registered. `destroy` disposes the
  extensions in reverse list order, each one's subscriptions in reverse (also ones pushed after activation,
  e.g. once a room connected), then the frame.
- **No services: generic contribution points.** Extensions never depend on each other, also not through a
  service registry. When one has something for another, a host offers a generic contribution point that any
  extension may use, and the consumer reads every contribution, not one provider's: document links
  (`registerDocumentLinkProvider`: the `documentLinks` extension's paths, read by the views and by `images`),
  file decorations (`registerFileDecorationProvider`: `collaboration`'s presence, shown by `files`), source
  controls (`registerSourceControl`: `collaboration`'s GitLab room, shown by `sourceControl`). VS Code's shapes.
- **Commands** (`Commands`, VS Code's shape, decided 2026-10-10): plain string ids `<extension>.<name>` (no
  registry type, no declaration merging: the caller knows a command by its id and the arguments it documents).
  `executeCommand<T>(id, ...args)` calls the handler synchronously (`Promise.resolve(handler(...))`, so the user's
  gesture, the selection and the focus are as at the call) and resolves to its (awaited) result; an unknown id or a
  throwing / rejecting handler rejects. The built-ins: `pdfExport.export(options?)` → Blob,
  `comments.addComment()` (bound to `Mod+Alt+KeyM`), `documentLinks.createFile(path)` (a link's command),
  `sourceControl.commit()`, `files.newFile` / `newFolder` / `upload` / `rename` / `delete`,
  `spreadsheets.newSpreadsheet`, `diagrams.newDiagram` (each with an optional row). Hosts run them through `editor.executeCommand`; menu entries name them by id (a menu or key binding logs a
  rejection with `console.error`; the command tells the user itself).
- **Settings** (`Configuration`, `configuration/`, VS Code's configuration, decided 2026-10-10): declared by the
  extensions (`contributes.configuration`, an id declared twice throws) and by the workbench itself
  (`workbench.theme`); the values come from the host (`settings`) and replace each other as a whole
  (`WorkbenchHost.settings = …`: ids left out go back to their default). A value counts only with the declared
  type (and in `enum`); otherwise the default, with a warning. `get` gives the value or the default;
  `inspect(key)` → `{ key, defaultValue, globalValue? }` tells whether the host set one (preview-sync: a host value
  wins over the viewer's remembered choice, the default does not); `onDidChangeConfiguration` fires once per
  replacement that changes any effective value, `affectsConfiguration('pdfExport')` / `('pdfExport.download')`.
- **Document links** (`DocumentLinks`, `document-links/`): the links of every provider for a `TextDocument`
  (`{ path, text }`: a whole file's, or a raw box's code with the path of its file); overlapping ones go to the
  provider of the higher `priority` (default 100; equal: registered first). A link remembers its provider, which
  `resolveDocumentLink` asks to fill in `target`, `tooltip` and `command` when the link is shown or followed. The
  workbench registers `linkExtension` with every Source view and every raw box's code (see "File links").
- **File decorations** (`FileDecorations`): `getFileDecorations(path)` gives every provider's, in registration
  order; `onDidChangeFileDecorations` fires for any provider's change, and when one comes or goes.
- **Source controls** (`SourceControls`): registered once per `id`, listed in order; `commit(message)` starts a
  commit whose outcome shows in `state` (`busy` meanwhile; `status`: the last outcome or news as `{ message,
  severity }`, which the `sourceControl` extension tells as a message whenever it is a new object).
- **Messages** (`Notifications`, `notifications/`; VS Code's `window.show…Message`): a small area at the bottom
  right of the widget, newest last, at most three (a new one closes the oldest). Not modal and never takes the
  focus. Information is `role=status` and closes by itself after 8 s (not while it has items, the pointer or the
  focus); warnings and errors are `role=alert` and stay. Each has its items as buttons and a close button; the
  promise resolves to the item chosen, else undefined. Features tell refusals and failures this way (a refused
  upload, rename or new file, "No PDF: …", a failed save to GitLab) and ask for confirmations (Delete).
- **Input box and quick pick** (`QuickInput`, `quick-input/`; VS Code's `window.showInputBox` / `showQuickPick`):
  one box at a time over the widget (a new one cancels the open one). Placed below what the user last pressed
  or typed in (a capture listener on the widget: a toolbar button, a menu entry, a file row); when that is an
  editor (`contenteditable`, CodeMirror's content), below the selection; without either, at the top in the
  middle; kept inside the widget, above the anchor where there is no room below. The input box is a form named
  by `title` (the field by `prompt`, shown below it), Enter or OK accepts unless `validateInput` (checked while
  typing, after the first keystroke, and on Enter) says what is wrong. The quick pick is a `role=dialog` with a
  filter field (`role=combobox`) over a listbox: typing filters by label, arrows move, Enter or a click picks;
  with `canPickMany` a checkbox per item and OK. Escape or a press outside cancels (undefined); closing gives the
  focus back to where it was. This replaced `FieldPopover` and the file panel's inline prompts: every feature
  asks the same way (decided 2026-10-10).
- **Menus** (`Menus`, `menus/`; VS Code's `contributes.menus`): `registerMenuItem(menuId, item)` adds an entry
  that runs `item.command` (a command id, any extension's); whoever shows the menu asks `getMenuItems(menuId,
  context)` for the entries whose `when(context)` holds, sorted (group `navigation` first, the other groups by
  name, then `order`, then registration order) and runs the command with the menu's arguments. `when` is a
  predicate over the context the menu is shown in, not a context-key expression (no global context keys were
  needed: each menu passes what it is shown for). Menus by id:
  `editor/title` — the tab bar, shown by the workbench (`.typst-editor__tab-actions`, `role=toolbar` "Editor
  actions"; context `{ editorMode, resource }`; no arguments; shown again on a tab switch, a file shown, a
  registration; pressing an entry keeps the editor's selection): `comments`' "Comment" (Source tab),
  `sourceControl`'s "Save to GitLab…". `file/newFile` — "New" in the file panel's header (`files`' entries, "New spreadsheet…", "New diagram…"), and
  `explorer/context` — a file panel row's context menu (context `{ view: 'files', resource, resourceKind:
  'file' | 'folder', resourceIsMain }`; argument: the row), both shown by the `files` extension with
  `ui/popup-menu`. The tab bar takes nothing but menu entries (`registerTabBarItem` is gone).
- **Custom editors** (`CustomEditors`, `custom-editors/`; VS Code's custom editors, decided 2026-10-10): `open(path)` shows a
  Typst file in the tabs and any other file in a custom editor: the one asked for (`open(path, { viewType })`), else
  the one whose `filenamePattern` matches the file's name (a glob: `*`, `**`, `?`, `{a,b}`; with a `/` over the path;
  case-insensitive) with the highest `priority` (`'default'` = 100; `'option'`: only when asked for), then the most
  specific pattern (the characters a name must have: `*.drawio.png` over `*.png` over `*`), then the one registered
  first. Nothing shows for a file no editor matches. Every open (also of the shown file: a replaced file shows its
  new content) gets a new panel (`element`: a flex column `.typst-editor__custom-editor` in the editing area);
  showing anything else disposes it: `onDidDispose` fires while the element is still in place (the editor stores what
  is pending), then the element goes. The editors: `images` (`images.preview` for `*.{png,jpg,jpeg,gif,svg,webp}`,
  `images.file` for `*`: any other file), `spreadsheets` (`spreadsheets.editor`, `*.ic`), `diagrams`
  (`diagrams.editor`, `*.drawio.png`, priority 110); they store edits with `applyChange`. Core knows no kinds of
  files besides Typst source (`ProjectPath.isTypst`): what a file is, is the editors' business, by name.
- **Stylesheets** (`StyleSheets`, `style-sheets/`): the widget's own CSS (`styleSheet`: the Visual view's
  `visual-view.css`, `typst-editor.css`, the layout's `layout.css`) goes in first, as `<style
  id="typst-editor-styles">`, before the frame is built (the color scheme reads the resolved colors); each
  extension adds its own `extensions/<name>/<name>.css` (imported `?inline`) with `registerStyleSheet` on
  activation, after it. Both go where the widget renders: its shadow root, else `document.head`. Widgets in one
  root share each distinct stylesheet (one `<style>`, reference-counted); disposing the last registration
  removes it, so `destroy` leaves no CSS behind. Class names stay the extensions' own; colors come from the
  `--te-*` tokens on `.typst-editor` (base stylesheet), so extension sheets follow light and dark.
- **Keys** (`Commands`): `registerKeybinding(key, command)` handles `key` on the widget in the capture phase,
  so the command runs before an editor sees the key, which then never does (`preventDefault` is decided at once;
  a failing command is logged). `key`: modifiers (`Mod` = Ctrl or
  Cmd, `Ctrl`, `Meta`, `Alt`, `Shift`) and a `KeyboardEvent.code`.
- **Drops** (`FileDrops`): files from the computer dropped on the widget never make the browser open them;
  while someone listens to `onDidDropFiles`, the drop hint (`typst-editor--dropping`) shows and the files go
  to the listeners. A view inside that stops the drop keeps it.
- **View contributions by extension:** `typstLanguage` (`typstLanguage()`, `codeColors`; Visual: the same in raw
  boxes), `documentLinks` (a `DocumentLinkProvider`), `collaboration` (`sourcePresence`; Visual: `visualPresence`:
  highlights, an editor extension and a box code extension; Workbench: `presenceDecorations`, the GitLab room's
  source control), `diagnostics` (`lint(collection)`;
  Visual: highlights); `images` (Visual: `imagesVisualView`; Workbench: the custom editors `images.preview` / `images.file`),
  `renderedBoxes` (Visual: `renderedBoxesVisualView`), `comments` (Visual: `marginNotes`, `notesGutter`; Preview:
  the PDF export option `comments.include`), `labels` (Visual: `references`), `styles` (Visual: `customStyles`); `sourceControl`
  ("Save to <label>…" in the tab bar's menu, its outcomes as messages); `previewSync` (`followCursor`; reveal, clicks), `previewControls`
  (`zoomControls`, `pageNumber`), `pdfExport` (`downloadPdf`), `diagrams` (Workbench: the custom editor
  `diagrams.editor`; Visual: the box action "Edit diagram"). The Visual view's constructs
  (`markup`, `headings`, `tables`, `outline`, `pageLayout`, `lists`, `alignment`) are extensions in
  `extensions/<name>/`: the entry's `activate` registers specs, toolbar groups and items from its `visual-view/`
  folder through `context.visualView`. No host has built-in contributions any more.
- **The active editor** (`activeTextEditor`, `onDidChangeTextEditorSelection`, VS Code's names): `comments`
  adds a note at its selection (and opens the note's card through its own notes gutter), `collaboration`
  publishes its selection, `previewSync` has the preview follow it.
- Every extension lives in `extensions/<name>/` (the entry exports the extension factory, e.g. `images()`, and only
  what other code needs). An extension imports no other extension.
  The extensions' Visual-view contributions are also exported for `testing/testing.ts` (a view with
  the built-ins, configured from test options). Extensions configure nothing through their factory any more
  (`comments()`, `files()`, `pdfExport()`, …): settings and `Workbench.user` instead; only `collaboration(options)`
  takes the host's connection.

### Paths (`src/core/paths`)

```ts
type ProjectPath = string & { __type: 'ProjectPath' }      // '/chapters/intro.typ': absolute, no '.', '..' or empty segments
type PathReference = string & { __type: 'PathReference' }  // 'img/logo.png', '../x.typ', '/data.csv': as written in Typst
ProjectPath.parse(value) → ProjectPath | null    ProjectPath.of(value) → ProjectPath (throws; constants, tests)
ProjectPath.fromName(typed, extension) → { path } | { error }    // "chapter 2" → /chapter 2.typ
ProjectPath.resolve(file, reference) → ProjectPath | null         // as Typst resolves it; null: leaves the project
ProjectPath.referenceTo(file, target) → PathReference             // relative in the same folder tree, else absolute
ProjectPath.isTypst / displayName / extension                    PathReference.of(written)
```

- **Branded strings, not classes**: free at runtime, usable as `Map`/`Record` keys, unchanged through
  `postMessage`, Yjs maps and the server. The compiler refuses a `PathReference` where a `ProjectPath`
  is meant (`project.has(reference)`), and a plain string for either.
- **Parsed once, at the edges**: the public API (`main`, `files`, `open`), Yjs keys and awareness
  states of other clients, drag data, localStorage (open folders), uploads' file names and the
  engine's paths (the workbench's preview jumps, the diagnostics status: package files are no project paths) go through `parse`; what is not
  a path is dropped there (a host's invalid `files` key throws). Inside, every path is typed.
- `ProjectFiles` stays string-keyed: the plain data the host and the engine exchange.

### `TypstDocument` (`src/core/typst-document`)

```ts
new TypstDocument(text)
.text
.change(changes: {from, to, insert}[], origin)   // all in pre-change coordinates (CodeMirror ChangeSet semantics)
.setText(text, origin)                           // one minimal change
.onDidChange: Event<{ contentChanges, origin }>   // subscribe → Disposable; in the order the changes were made
```

- **Single source of truth.** Every view writes through `change()` and reads through `onDidChange`.
- **Echo suppression by origin.** A view passes itself as `origin` and ignores notifications whose
  origin is itself.
- **Ordered delivery** (VS Code's delivery queue): a change made by a listener while the document tells
  about another is told once every listener has heard the first, so each listener sees the changes in the
  order they were made (the collaboration's `TextBinding` relies on it: it is subscribed after the views).
- **No collaboration in core** (decided 2026-10-11; ESLint: core imports no `yjs`, `y-*`, `@hocuspocus/*`).
  The collaboration extension binds a document to a shared `Y.Text` from outside, like y-codemirror binds an
  editor: `TextBinding` (`extensions/collaboration/model/text-binding.ts`) first adopts the Y.Text's text
  (`setText`, one minimal change), then writes each local change into the Y.Text in one transaction of its own
  and turns every other transaction (another user) into `change(…, REMOTE_ORIGIN)`, the event delta converted to
  pre-change changes (`deltaToChanges`, `y-delta.ts`). `REMOTE_ORIGIN` is the collaboration's
  (`remote-origin.ts`). The views need no change.
- **Undo is per user** (decision): each view keeps its own history. Remote changes never enter
  it, and the histories map over them. The VisualView never adds an outside change to its history; the
  SourceView adds changes from elsewhere (the same user's Visual edits) and marks their transactions with
  `fromDocument` (`{ origin }`, exported by the Source view host); the collaboration's `perUserUndo`
  (a `transactionExtender` it registers with `sourceView.registerExtension`) sets `addToHistory: false` on
  those with `REMOTE_ORIGIN`. A user's Undo reverts the last edit of that view's history, never a
  collaborator's. No `Y.UndoManager`.

### `typst-engine` (Rust crate + `src/core/typst-engine`)

```ts
createEngine(wasm, fonts?: (Uint8Array | Promise<Uint8Array>)[]) → Promise<Engine>
fetchFonts(DEFAULT_FONT_URLS) → Promise<Uint8Array>[]   // the bundled font assets (URLs: core/engine-assets)
.addFont(bytes)                                  // throws if bytes contain no font face
.setSource(path, text) / .setBinary(path, bytes) / .remove(path)
.compile(main) → { pages: [{hash, width, height, svg}], diagnostics: [{severity, message, hints, path, from, to}], missingPackages: string[] }
.exportPdf(main) → { pdf: Uint8Array | null, diagnostics, missingPackages }   // keeps the hit-testing document
.jumpFromClick(page, x, y) → {kind:'source', path, offset, from, to, boxes} | {kind:'url'} | {kind:'position'} | null
.jumpFromCursor(path, offset) → [{page, x, y}]
.boxesForRanges(path, [{from, to}]) → [{page, x, y, w, h}]   // where those ranges are drawn: per glyph run, shape, image

withPackages(engine, fetchPackage = fetchPreviewPackage) → { compile(main) → Promise<CompileResult>, exportPdf(main) → Promise<PdfResult> }
PdfEntry = { main, sources }                       // what a PDF compiles: entry file + .typ texts replacing/adding the project's,
                                                   // for that export only (the preview's exportPdf, PDF export options, comments' withoutNotes)
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
  pinned by `Cargo.lock` into `src/core/typst-engine/fonts/`. `core/engine-assets` turns them into bundler
  assets (`import.meta.glob(…?url)`); `fetchFonts` starts all downloads at once. The worker passes them to
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

### `VisualView` (`src/hosts/visual-view`)

```ts
new VisualView(parent, document, contributions: VisualViewContributions)
.reveal(from, to)    // select exactly what shows source range from..to (caret if empty)
.setHighlights(layer, highlights)   // source ranges → inline decorations (sourceToPos, end with bias -1)
.selection() → {from, to}           // posToSource; the end with bias -1
.onDidChangeSelection: Event<void>  // after the selection moved or the text changed
.destroy()

// the contribution points (registered once; applied to every view created afterwards)
const visualView = new VisualViewContributions()            // or VisualViewContributions.from(contributions)
visualView.registerNode(spec: TypstNodeSpec) → Disposable    // schema node + projection + printing + flags
visualView.registerMark(spec: TypstMarkSpec) → Disposable
visualView.registerEditorExtension((view) => tiptapExtensions) → Disposable   // decorations, plugins, commands
visualView.registerToolbarGroup({ kind: 'group' | 'menu' | 'floating', id, order, … }) → Disposable
visualView.registerToolbarItem({ group, order?, action } | { group, order?, create(toolbar) }) → Disposable
visualView.registerGutter((view, body) => { plugin?, destroy() }) → Disposable
visualView.registerHighlights(layer, { provideHighlights(document), onDidChangeHighlights }) → Disposable
                                     // set on a view's creation and on every change of its document (diagnostics)
                                     // Highlight { from, to, className, attributes? }: the host's own type (only the
                                     // Visual view draws highlights; the Source view's contributions use CodeMirror
                                     // decorations), exported from hosts/visual-view
visualView.registerBoxRenderer((view) => BoxRenderer | null) → Disposable
visualView.registerBoxCodeExtension((view) => codeMirrorExtension) → Disposable
                                     // a box's code gets its node decorations as the effect setBoxDecorations
visualView.registerBoxAction({ title, when?(node, view) → boolean, run(node, view) }) → Disposable
                                     // a button on every raw box `when` holds for (diagrams: "Edit diagram")

// the constructs are extensions (extensions/: markup, headings, tables, outline, pageLayout, lists, alignment); the
// features' contributions, each a VisualViewContribution = { id, activate({ visualView, subscriptions }) } shaped
// like a TypstExtension, configured by their feature's extension, in extensions/<name>/visual-view/:
// imagesVisualView({ assets, imageUrls, imageLinks }), renderedBoxesVisualView({ snippets }),
// marginNotes({ comment }), notesGutter({ user }), visualPresence(presences, documents), references({ labels }),
// customStyles({ styles, create })
```

The editor is **Tiptap 3**, which is ProseMirror underneath. Tiptap provides the keymaps (Mod-B/I,
undo), the input rules (`## ` → heading, `- ` → list) and list handling. The source-of-truth logic
lives in `hosts/projection/`, a module of its own (the Visual view host builds on it, specs are written against its
types), which is plain ProseMirror and knows nothing about Tiptap:

```
 text ──typstParser (Lezer)──► CST ──project(text, schema)──► PM doc   (nodes carry attrs.src / attrs.sep)
                                                               │ user edit (PM transaction)
 text ◄── document.setText() (minimal change) ◄── print() ◄────┘   (untouched nodes print attrs.src verbatim)

 text changed elsewhere ──► project() ──► syncDoc(tr, target): smallest replacement, cursor stays put
```

- **Host and contributions.** The host keeps the mechanism: the Tiptap editor; the projection
  framework (segmenting markup into blocks, source anchors, printing with the minimal change back,
  sync, the position map); paragraphs, text, line breaks, escapes and shorthands; raw Typst
  (`rawBlock` / `rawInline` in raw boxes, the fallback for whatever no spec models); the toolbar
  with undo/redo, the "Insert" menu and the "Selection" bar; highlights. Other users' carets are the
  collaboration extension's, drawn through the generic points (highlights, an editor extension, a box code
  extension, the context's position map). Every other
  construct (headings, lists, tables, …) is an extension (`extensions/<name>/visual-view/`) and every
  feature shown in the view (labels, comments, styles, …) a contribution of its extension, using only the entries: the Visual view's (the contribution types, `starterKitPart`, `createSchema`), the
  projection's (the spec contract: `ProjectionContext`, `Call`, `Placed`, `Printer`, …; and for tests `project` /
  `print` / `syncDoc` / `posToSource` / `sourceToPos`), core's `typst-syntax` (reading syntax nodes), and
  `testing/` for the built-ins together). The widget's built-in extension list activates them (see
  "createTypstEditor"); `VisualViewOptions` is gone.
- **Specs** (`TypstNodeSpec` / `TypstMarkSpec`; their `NodeGrammar` / `MarkGrammar` in `projection/projection.ts`): one per construct —
  `name`, its Tiptap `extension` (schema, node view, commands, keymap, input rules), `attributes`
  the host adds (source anchors like `src`, `sep`, `marker`, `layout`), `anchors` (compared like
  `src` / `sep` by `syncDoc`), `keepsDom`, `labelled`, `box` (`'code'`: the host's raw box node
  view, with `codeBox` for a heading and tools; `'widget'`: a remote caret inside outlines it),
  `container` (list items: their list). Projectors: `blockSyntax` (`Heading`, `ListItem`,
  `EnumItem`; `takesLabel`), `runSyntax` (`Raw` as a code block), `blockCalls` by function name
  (`*`: any other call — declared paragraph styles), `inlineSyntax` (`Strong`, `Emph`, `Link`,
  `Raw`, `Ref`: such syntax makes a run prose), `inlineCalls` (`#link(..)[..]`, margin notes, text
  styles; `matches` makes the run prose). Printing: `print` (an edited block, through the
  `Printer`), `printAtom` (an inline atom's source), `escapeAfter` (`@intro\s`); a mark's `print`
  (`*x*` or `#strong[x]`), `raw` (inline code: innermost, unescaped) and `printsBare` (a bare URL).
  `onDidChange` makes every view project its document again (styles declared or removed). What
  the framework used to list by name (`BLOCK_CALLS`, `PRINT_BLOCK`, `RAW_TYPES`, `LABELLED_BLOCKS`,
  `callAtomType`, the inline boxes of presence, the anchors) is derived from the specs; the
  projection imports no feature. A second spec of the same name extends the first (alignment adds
  `#par(justify: ..)` and the paragraph printer); **priority**, not registration order,
  decides where contributions compete (`registerNode` / `registerMark` / `registerBoxRenderer(…, { priority })`:
  default 100, higher first, Tiptap's semantics; equal ones in registration order): the schema's order (a
  higher mark nests outside a lower one), which of the projectors of the same syntax or call is asked first
  (task lists, 110, before bullet lists: a task item is a bullet item `- [ ]`), and which box renderer draws a
  raw box (images' renderer, 110, before compiled snippets). Toolbar items keep `group` + `order`. `attachGrammar` puts the specs on the schema (`schema.cached`), so `project(text,
  schema)` and `print(doc)` find them; `VisualView` attaches them to its editor's schema, tests use
  `createSchema` (the host's tests with their own specs; the built-ins' `schema` of `testing/testing.ts`).
- **Per view**: providers get a `VisualViewContext` (`document`, `selection()`, `sourceToPos(doc, offset, bias?)` /
  `posToSource(doc, pos, bias?)`: the position map over a document node of the view, e.g. a transaction's;
  `isBox(node)`: shown as a box of its own); a toolbar item's
  `create(toolbar)` gets the `ToolbarContext` (the editor, the toolbar's root, `subscriptions`
  disposed with it, `element(group)`, `refresh()`). Contributions are registered once and applied
  to every view created afterwards.
- **Schema** (the host's `nodes/nodes.ts` and the built-ins' specs):
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
    its `src` is code, without `#` (`isEmbeddable` in core's typst-syntax).
  - `taskList` > `taskItem` (Tiptap's, `checked`; one paragraph, not nested; `extensions/lists/`).
  - `blockquote` (Tiptap's; holds blocks; `layout` is the source around its content).
  - `pageBreak`, `horizontalRule` (atom blocks keeping their call as `src`, shown as a labelled
    dashed divider / a rule; `extensions/page-layout/`).
  - `alignment` (`extensions/alignment/`): `#align(args)[blocks]`, content `block+`. `args` is the
    literal alignment as written; `layout` (an anchor) is the source around the blocks.
    Paragraphs have a `justify` attribute (`true` / `false` / `null`) for
    `#par(justify: ..)[text]`.
  - **Inline:** text with `bold` / `italic` / `link` (Tiptap's link mark, `href`) / `code`
    (Tiptap's, extended: combines with other marks; `fence` and `lang` remember ```lang …```) marks;
    `softBreak` (a source newline that renders as a space); `hardBreak` (`\`); `rawInline`;
    `reference` (inline atom, `target` + `supplement` as written: `@key` / `@key[..]`, a chip).
  - **Labels:** a global `label` attribute (`{ name, gap }` or null) on every block a markup
    segment can become (paragraph, heading, code block, raw block, image, outline, figure, table,
    quote, alignment, page break, rule, styled block: the specs that are `labelled`). It is printed after the block (`gap` + `<name>`), maps to
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
    is exactly one call (the specs' `blockCalls`): an `image` for
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
- **Toolbar** (`toolbar/toolbar.ts`, created by `VisualView` above the editor), laid out from the
  contributed groups (`registerToolbarGroup`: a group of buttons or a menu in the row, sorted by
  `order`, or a bar floating in the text) and items (`registerToolbarItem`: an `Action`, or
  `create(toolbar)` for an item with per-view state or a control of its own); groups without
  items are left out. The host's own: undo/redo (`history`, 10), the **Insert** menu (`insert`,
  50) and the **Selection** bar. With the built-ins, kept short: undo/redo, a text style menu
  (`text-style`, 20: normal text, heading 1–3, custom styles; the `styles` extension's), bulleted/numbered/task list
  (`lists`, 30), an **Align** menu (`align`, 40: left, center, right, justify; its icon is the
  current alignment), the **Insert** menu (image, table, table of contents — an `#outline()`
  block —, code block, quote, page break, horizontal rule, add label (`labels`)), and "Comment" (`comments`,
  60) when the margin notes get a `comment` (enabled with a caret or selection in text outside
  code blocks). Menus: `ToolbarMenu` (`ui/toolbar-menu/`, `role="menu"` of toolbar buttons;
  Escape, outside click, arrow keys). Bars float in the text column (`FloatingBar`,
  `ui/floating-bar/`, placed in `.typst-visual__body` so they scroll with the text, shown while
  the text or the bar has focus; of the floating bars only the first, by `order`, with an anchor
  shows): **Selection** (`selection`, 10: bold, italic, code (Mod+E), link, comment) above a text
  selection or where an item asks for it (`Action.showsBar`: a link holding the cursor) — the
  only place of the mark buttons —, and **Table** (`table`, 20: add/delete row/column, header
  row) above a table holding the cursor. Entries are `Action`s (`visual-view.ts`):
  Tiptap chain commands; after every transaction the buttons show `aria-pressed` and are
  disabled when `editor.can()` (or the action's own `enabled`) says no.
  Mousedown is cancelled, so the text keeps focus and selection.
  - Link (in the Selection bar, and Mod+K in the text) asks for the URL in the workbench's input box
    (`Workbench.showInputBox`, placed at the selection; `markup` passes the workbench to `linkAction`).
    Link with nothing selected inserts the URL as linked text; inside a link it edits the whole link,
    and an empty URL removes it.
  - Insert image: without `assets` an input box for the path; with `assets` (`ImageAssets`: `list()`,
    `upload(file)` → `{ path } | { error }`) a quick pick (`showQuickPick`) of the project's images,
    "Upload image…" (a hidden file input, `image-uploads.ts`, opened within the user's gesture) and
    "Enter a path…"; either inserts an `#image("path")` block. With `assets`, image files dropped on
    or pasted into the text are uploaded and inserted as well (`imageFileDrops`; the drop stops
    there). Refusals are error messages (`ImagesOptions.prompts`: the workbench).
  - Image blocks (`image-insertion.ts`) go after the selected block, or after the paragraph /
    heading holding the cursor (an empty paragraph is replaced): never replacing or splitting
    content — the initial selection is a node selection on the first raw block (often
    `#set page(..)`).
- **Text alignment** (`extensions/alignment/`: `visual-view/text-align.ts`, `model/alignment-syntax.ts` for the Typst syntax):
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
- **Code blocks** (`extensions/markup/visual-view/code-block-view.ts`): a NodeView with a header holding a "Language" field
  (accepts only a valid tag, sets `language` as one types; Enter/Escape/ArrowDown go to the
  code) above a `<pre><code>` content DOM.
- **Raw boxes** (`nodes/raw-box.ts`): the nodes whose spec has `box: 'code'` (`rawBlock` /
  `rawInline`, and with the built-ins `image` / `outline`) render through a NodeView that hosts a
  nested CodeMirror (no own history), plus what contributions add: the spec's
  `codeBox` (a heading, e.g. an outline box's "Table of contents"; tools, e.g. an image box's,
  whose picture click then selects the box), the CodeMirror extensions of
  `registerBoxCodeExtension` (`typstLanguage`: Typst syntax and code colors, as in the Source view; the
  workbench's document links, as in the Source view: link tooltip on a path, Mod+click opens; no separate
  "Open …" row: it took too much space; the collaboration extension's carets in the box) and the first `BoxRenderer`
  (`registerBoxRenderer`) that `renders` the box, and the box actions (`registerBoxAction`, any contribution's, for
  any box: a `BoxActionBar` of the actions whose `when(node, view)` holds, asked again on every node update; the
  box's tools place it in their toolbar (`BoxToolsHost.actions`: the image toolbar, before "Edit code"), a box
  without tools shows it above its code; the diagrams extension's "Edit diagram"). A box hands its node's decorations to its code as the CodeMirror
  effect `setBoxDecorations` (when made and on every update), so a box code extension can draw what is marked on
  the box.
  - **Rendered boxes** (`nodes/rendered-box.ts` shows a `BoxRenderer`'s picture): while not
    focused, a box shows an `<img>` instead of its code; a renderer that `followsEdits` draws
    again on every node change, others on `onDidChange`. The built-ins: an `image` box shows its
    file (`images`, from `ImageUrls.imageUrl(path)`; follows path edits at once), any other box
    the compiled snippet of its source range (`rendered-boxes`, `SnippetSource.snippet(from, to,
    src)` as an SVG data URL; refreshed on `SnippetSource.onDidChange`).
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
- **Image tools** (`extensions/images/visual-view/image-tools.ts`, the image spec's `codeBox.tools`): the "Image: path"
  heading (the path is the document link on it, from `Workbench.provideDocumentLinks`: it opens the file, or says
  the file is missing: `imagePathLink`), a
  frame around the rendered picture sized from the call's `width` (`imageWidthCss`), and,
  while the image is selected (a click on the picture selects it; double-click, Enter or
  "Edit code" open the code): resize handles (corners, sides) and an "Image" toolbar
  (Add/Remove caption, Width 25/50/75/100 %, Alt text: an input box, empty removes it; the box actions of other
  extensions, e.g. "Edit diagram"; Edit code). A drag resizes live and writes
  `width: NN%` (whole percent of the text width, any other unit replaced) on release.
  - Every action is one transaction from `image-edits.ts` (one undo step): `addCaption`
    (image → figure with an empty caption, cursor in it), `removeCaption` (a figure without
    label/other arguments → `#image(..)` again, else only the caption goes), `resizeImage`,
    `setImageAlt`. `model/image-call.ts` edits one argument of the call in place (replace the value,
    append after the last argument, or remove with the preceding comma).
- **Input rules** (Tiptap's, plus ours): `> ` quote, `[ ] ` / `[x] ` task item; `---` (`—-`,
  `___ `, `*** `) becomes a rule only when it is the whole paragraph, since `---` is an em dash in
  Typst markup.
- **Task lists need cheq** (`extensions/lists/`: `model/checklist-preamble.ts`, `visual-view/checklist-preamble.ts`):
  Typst has no checkboxes; the Universe package cheq (pinned 0.4.0) draws `- [ ]` items as boxes under
  `#show: checklist`. `calculateChecklistPreambleChange(codeBlocks)` (model) decides what is missing of its import
  and show rule in the top-level raw blocks; `ensureChecklistPreamble(tr)` adds it, once; the `ChecklistPreamble` plugin calls it when a Visual edit (not a sync from the
  source) adds a task item, as an appended transaction (same undo step).
- **Heading numbers** (`extensions/headings/`: `model/numbering.ts`, `model/heading-numbering.ts`,
  `visual-view/heading-numbers.ts`): `headingNumbers(doc)` follows top-level `#set heading(numbering: ..)` rules
  with the model's `HeadingCounter` (Typst's heading counter: `readRules(code)`, `count(level)`); `numberingFormatter(pattern)` applies Typst numbering patterns (`1 a A i I * ①`;
  others → no numbers). A plugin draws them as node decorations (`data-heading-number`, CSS
  `::after` in a gutter right of the text; the editor gets `typst-visual--numbered`). Command
  `toggleHeadingNumbering` (no toolbar button; meant for the Inspector's document section) adds `#set heading(numbering: "1.")` after the leading raw blocks or
  removes the numbering arguments. Rules in content blocks, show rules and numbering functions are
  not followed (the preview is exact).
- **Remote presence** (the collaboration extension's `visual-view/`, Tiptap CollaborationCaret look, but fed from
  our text sync; it reads the places from its own `Presences`, the view host knows nothing of them):
  a caret is a widget decoration (bar + name flag, always shown) at `view.sourceToPos(doc, head, -1)`, so it
  shows in empty paragraphs too; a selection is a highlight (`registerHighlights('collaboration.selections')`). A
  caret inside a box (block atoms — raw blocks, images, outlines, page breaks, rules — from
  their first character to their line end; inline atoms whose spec has a `box`, `rawInline` /
  `marginNote`, strictly inside) outlines
  the box instead (node decoration `typst-remote-box`, the names as flag, first user's color);
  the decoration carries the carets' offsets in the box's source (`box-carets.ts`), and its box code extension
  (`boxPresence`) draws them in a raw box's nested CodeMirror (from `setBoxDecorations`). Mapped through edits until
  set again.
- **Invariants (unit-tested):**
  - `print(project(src)) === src` for every fixture (incl. links, images, figures, tables, unmodelled
    tables and figures, quotes, page breaks, rules, table headers, task lists);
  - edits change only what they touch;
  - an outside change to a paragraph keeps the cursor position in it.

### `SourceViewHost` / `SourceView` (`src/hosts/source-view`)

```ts
interface SourceViewContributions {                          // what ExtensionContext.sourceView offers
  registerExtension(extension: SourceViewExtension): Disposable     // CodeMirror extensions for every view
}
type SourceViewExtension = Extension | ((view: SourceViewContext) => Extension)
interface SourceViewContext { document }
fromDocument: Annotation<{ origin }>         // on transactions mirroring a document change made elsewhere

new SourceViewHost()                         // implements SourceViewContributions
.createView(parent, document, { onSelection? }) → SourceView

SourceView
.reveal(from, to)    // select, scroll to center, highlight (the one highlight the host draws itself)
.selection() → {from, to}
.destroy()
```

- **The host keeps the mechanism**: CodeMirror bound to a `TypstDocument` in both directions (`basicSetup`,
  line wrapping, the reveal highlight) and selection reporting. Changes from elsewhere are dispatched with
  `fromDocument.of({ origin })` and enter the view's undo history; what to keep out of it is a contribution's
  policy (collaboration's `perUserUndo`). Everything
  else is a contribution. A contribution is registered once and applies to every view, those made before
  (their `Compartment` is reconfigured; state of extensions kept in the new configuration survives, e.g.
  the carets shown) and those made later; disposing it removes it from all of them. A function extension
  is called per view with its `SourceViewContext`: its document.
- **Contributions from `extensions/`**:
  - `typstLanguage()` (`extensions/typst-language/source-view/typst-syntax.ts`, also in the raw boxes) — the
    Typst language support (`codemirror-lang-typst/lezer`: a pure-JS Lezer parser using typst-syntax node names,
    plus completion and folding; its Lezer syntax linter is left out so that compiler diagnostics are the only
    error source; its indentation service is wrapped so that Enter right after a closed construct like
    `#set page(..)` does not indent, which 0.6.0 gets wrong).
  - `codeColors` (`extensions/typst-language/source-view/code-colors.ts`) — see "Dark mode".
  - the workbench's document links (`hosts/workbench/document-links/`, the links of every
    `DocumentLinkProvider`) — see "File links".
  - `lint(diagnostics)` (`extensions/diagnostics/source-view/`, see "Diagnostics in the widget").
  - `sourcePresence(presences)` (`extensions/collaboration/source-view/`, y-codemirror style): each caret is a
    widget (bar + dot, also on empty lines); its name flag shows on hover and for 2.5 s after the caret moved (the
    widget is re-created only then: `moves` counts in its equality). Selections are tinted marks. It starts with
    the places known when the view is made and follows `Presences.onDidChange`; its `remotePresence` field (fed by
    the `setPresence` effect) also draws the carets in the Visual view's raw boxes.
- **Hidden:** CodeMirror's view and state, translating ChangeSets to and from `TextChange[]`, and the
  annotation that stops document-originated transactions from being written back.

### `Preview` (`src/hosts/preview`)

```ts
interface PreviewContributions {                             // what ExtensionContext.preview offers
  registerToolbarItem(item: (preview: PreviewContext) => { elements, update?(), dispose?() },
                      placement: { group, order? }): Disposable   // VS Code's menus: groups by name, `navigation` first
  registerPdfExportOption({ id, label, description?, default: boolean, apply(entry: PdfEntry, value) → PdfEntry },
                          { priority? }): Disposable                // unique ids; PdfEntry: core typst-engine
  pdfExportOptions() → PdfExportOption[]                       // by priority (default 100, higher first), then registration
  createOverlay(className) → { set(boxes: Box[]), dispose() }   // boxes in pt on their page
  reveal(path, from, to)                                       // cheap per cursor move: scroll to the range's start, only if off-screen (no marker)
  onDidClickPage: Event<{ path, from, to }>                    // a click on something with a source location
  onDidChangeDiagnostics: Event<Diagnostic[]>                  // of the newest update(), never stale
  onDidRender: Event<void>                                     // after every successful compile
  snippet(path, from, to, text) → Promise<{svg, width, height, textHeight, padding} | null>   // the range as drawn, cut from its page
  exportPdf(entry: PdfEntry) → Promise<PdfResult>      // the files of the last update(), entry.sources replacing/adding texts
}
interface PreviewContext { ownerDocument, zoom(), setZoom(zoom), scale(), visiblePage() → {index, count},
                           pdfExportOptions() }

new Preview(container)                       // implements PreviewContributions; renders a toolbar +
                                             // scrolling page area into container
.update(files: Record<path, text | Uint8Array>, main)    // cheap per keystroke
.destroy()
```

- **The host keeps the mechanism**: the engine worker and its protocol, coalesced compiles, the page list,
  hit-testing (with the click highlight; `onDidClickPage`), scrolling and `reveal`, and the view state
  toolbar items read and set through `PreviewContext`: zoom, which page is visible. When to reveal what, and
  where a click leads, is the `preview-sync` extension's (see "createTypstEditor"). Toolbar items are placed by
  `group` + `order` (VS Code's menus, decided 2026-10-10: groups by name, `navigation` first, then `order`, then
  registration order), so an item registered again (a setting switched it off and on) comes back to its place;
  their `update()` runs at most once per frame after a scroll, resize, zoom or new pages.
- **Toolbar items** come from extensions (the host has none of its own): `preview-sync`
  (`extensions/preview-sync/preview/`) registers `followCursor({ on, onChange })` in group `1_sync` (a `role=switch`; the choice is
  remembered in localStorage; switching it on reveals the selection at once; made anew when the host changes
  `previewSync.followCursor`); `preview-controls`
  (`extensions/preview-controls/preview/`) registers in group `2_view` `zoomControls` (− / + to the neighbouring preset of
  25 %–400 %, Fit, 100 %, and "Fit · 83%" / "125%"; presets and labels in its `model/zoom.ts`)
  and `pageNumber` ("3 / 12"); `pdf-export`
  (`extensions/pdf-export/preview/`) registers `downloadPdf` (below) in group `3_export` while `pdfExport.download`
  is on.
- **Page overlays** (`createOverlay`, `pages/overlays.ts`): boxes in pt, drawn as children of the page
  elements in percent of the page, so they survive zoom and lazy unmounting; drawn again after every
  successful compile. The host's click highlight is one.

- **Snippets** (`snippet.ts`): no extra compilation. After running compiles are done, the range
  goes to `boxesForRanges`; the union of the boxes on the first box's page (+2 pt, clamped to
  the page) becomes the page SVG with that `viewBox` and size in pt; `textHeight` is the tallest
  box (one line of its biggest text), `padding` the 2 pt. Null when the range draws
  nothing, or when `text` is not what the range held at the last successful compile (it was
  edited since, or the document has errors), so a snippet never shows other source.
  A call whose drawn glyphs all come from its definition (`ms(6)` with `#let ms(v) = [#v ms]`:
  the glyphs' spans lie in the `let`) draws nothing in its own range, so its box keeps showing code.

- **Download PDF** (`extensions/pdf-export/preview/preview.ts`, `downloadPdf(pdfs, memory, messages)`): one button. With
  export options registered it opens a `role=dialog` popover ("PDF options") with a checkbox per option registered
  by the time it opens (label, `description` as tooltip; checked as this viewer left it, else its default; each
  change saved to the memory at once) and "Download" (Escape, a second click or a click outside closes it);
  without options it downloads at once. While a PDF is made the buttons are disabled and the button says "Making
  PDF…" (`aria-busy`); a rejection is an error message "No PDF: <message>" (`Workbench.showErrorMessage`). The
  options stay a popover of their own (not a quick pick with `canPickMany`): the user decided on one button with
  an options popover, whose choices are saved as they are ticked, and "Download" says what happens. The file is
  saved through an object-URL link.
  `exportPdf` waits for running compiles (`LatestOnly.idle`), so it exports the newest text.

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
- **Click highlight** (a page overlay): a click that resolves to a source location outlines the clicked text run (Typst draws one as a `<g>` of glyph `<use>`s) until the
  next click or successful compile.
- **Scrolling** only ever moves the preview's own scroller (never `scrollIntoView`), so an embedded
  widget does not scroll its host page.
- **Errors keep the last good pages.** When a compilation fails, the preview keeps showing the
  previous pages, dimmed (`typst-preview--stale`), and reports diagnostics through `onDidChangeDiagnostics`.
- **Diagnostics are never stale.** `onDidChangeDiagnostics` only fires when no newer `update()` is
  waiting, so its offsets always refer to the text last passed in.
- **Files:** text is sent with every update (Typst diffs it). Bytes are sent once per
  `Uint8Array` identity: pass the same array again and only `null` crosses to the worker.
- **Packages:** `@preview/…` imports are downloaded on first use (see `withPackages`); the
  diagnostics arrive after the download.
- **Coordinates:** the SVG is scaled to the page element's width (zoom). Clicks are converted with
  `pt = (clientX − pageRect.left) × page.width / pageRect.width`.

### Worker protocol (`src/hosts/preview/worker`)

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

### Labels and references (`src/extensions/labels`)

```ts
labels(): TypstExtension     // one LabelIndex (disposed with the widget) + references({ labels })
// model/ (no DOM)
new LabelIndex(project)        // implements ProjectLabels (what the Visual view reads)
.labels() → LabelInfo[]        // { name, kind: heading|figure|table|listing|equation|bibliography|null, title, path }
.referenceCount(name)          // @name references in all files
.renameReferences(from, to, except?)   // changes the other .typ files, one change each (calculateReferenceRenames)
.onDidChange: Event<void>      // only when the label list changed
.dispose()
labelChoices(labels, query) / describeLabel(label)   // the @ list's choices, "Section · Method"
referenceSyntax / labelName / LABEL_CHAR / guardAfterReference(supplement, text)   // Typst's syntax
// visual-view/
references({ labels? }): VisualViewContribution   // the `reference` node spec, label tags, the @ list, hints, "Add label"
```

- **Why one extension:** labels and references span files, so the read model follows the whole project
  (`Project.onDidChangeFile`; `Project.replace` reports every file, so no refresh is needed), and the Visual view's
  contributions read it through `ProjectLabels`. The Source view does not use it yet.
- **Scanning:** every `.typ` file is scanned with Lezer (`model/scan.ts`) when the index is made and again on each
  of its changes; `.bib` files give their entry keys. A label's kind and title come from the element before it: a
  heading (its text), `#figure(..)` (by its body: image → figure, table → table, raw → listing; its caption), an
  equation.
- **The block's label** is the host's (a `labelled` spec's `label` attribute, see "VisualView"); this extension
  draws and edits it. A new label goes on through the toolbar's Insert ▾ → "Add label": a draft tag with a field
  appears right where the tag will be (`startNewLabel`, `visual-view/label-tags.ts`; target from `add-label.ts`:
  the figure the selection is in, else the innermost block that can carry one; `fig:` / `tab:` / `sec:`
  prefilled); Enter adds the label, Escape or leaving the field drops it. An existing label is renamed or removed
  through its tag.
- **References** (`@key`, `@key[supplement]`) are `reference` atoms (`target`, `supplement` as written); text
  printed right after one that would extend its name gets a backslash (`@intro\s`, the spec's `escapeAfter`).
- Reference chips show the label's name; `referenceHints` adds what it labels (`data-hint`, "Section · Method",
  "Figure · <caption>", from `describeLabel`) as a hover tooltip only or marks it `typst-visual__ref--unknown`
  (wavy, tooltip) when the project has no such label. Redrawn when the doc or the label list changes.
- `labelTags`: a widget per labelled block — at the end of a textblock's text, below other blocks. Clicking it
  opens a quick pick (`ReferencesOptions.prompts`: the workbench's) of **Rename…** (while anything refers to the
  label: "and update N references", which also renames the references: this view in the same transaction, one
  undo step; other files: `ProjectLabels.renameReferences`, one change per file), **Rename without updating
  references…** (only while there are references) and **Remove label**; renaming asks for the name in the input
  box. Names are cleaned up by `labelName` (spaces → `-`).
- `referenceSuggestion` (own plugin, not `@tiptap/suggestion`: its popup mounts into `document.body` and its
  outside-click check fails across the shadow root): `@` after a space/bracket/line start in prose opens a list
  (`labelChoices`: name prefix, then name, then title matches; at most 8) below it, inside `.typst-visual__body`.
  ArrowUp/Down, Enter/Tab or a click insert the chip in place of `@query`; Escape dismisses that `@`. Typing a
  space or punctuation right after the whole name of a label (`@intro `) inserts the chip as well.
- Without `labels` (tests): tags only (rename and remove of the label itself).

### Custom styles (`src/extensions/styles`)

Concept: docs/2026_10_10_custom-styles.md, option (a). A style is a Typst function declared with a
doc comment; the editor never keeps a registry of its own:

```typst
/// @style paragraph Note
#let note(body) = block(fill: luma(240), inset: 8pt, body)
/// @style text Keyword
#let key(body) = text(weight: "bold", body)
```

```ts
styles(): TypstExtension     // one StyleIndex (disposed with the widget) + customStyles(..) + "New style…"
// model/ (no DOM)
scanStyles(text) → [{ name, kind: paragraph|text, label }]   // `///` line + `#let f(body, named: ..)` (one positional parameter)
new StyleIndex(project)        // implements ProjectStyles (what the Visual view reads)
.styles() → Style[] (+ path)   .onDidChange: Event<void>   .homeFile()   .dispose()
.calculateImportChange(document, style, use) → TextChange | null   // relative to the document's path; null in the declaring file
calculateImportChange(text, { name, matches(module), create(), use? }) → TextChange | null   // core/typst-syntax
newStyle(text, label = 'New style') → { text, from, to }   // "New style…": `styleName(label)`, numbered if taken
styleName(label) → string   // `Side box` → `side-box`; starts with a letter (`style-2-columns`)
// visual-view/
customStyles({ styles?, create? }): VisualViewContribution   // styledBlock + style mark specs, the text style menu
```

- **Projection:** the specs project the declared styles (`blockCalls['*']`, `inlineCalls`, from
  `ProjectStyles.styles()`; `onDidChange` makes every view project again). A run that is exactly
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
  adds the import (`ProjectStyles.calculateImportChange` at the selection; relative to the file, never
  into the file declaring it, a new import followed by a blank line so it stays its own block).
- **Look:** `.typst-visual__style.typst-style--<name>` (accent bar, the title as a badge) and
  `.typst-visual__style-text.typst-style--<name>` (dotted underline, title as tooltip); hosts
  style a style by its class. The preview shows the real look.
- **"New style…"** (the extension's entry) asks for the style's name in the input box (default "New style"),
  appends a paragraph style stub of that name to the file declaring most styles (`homeFile()`; else
  `/styles.typ`, created through the usual `applyChange` when missing; a refusal is an error message) and shows
  it in the Source view (`Workbench.open(path, { selection, mode: 'source' })`).

### Spreadsheets (`src/extensions/spreadsheets`)

Concept: docs/2026_10_10_spreadsheets.md; task docs/todo/ironcalc.md. Calculations happen in
IronCalc; Typst shows the results.

```ts
spreadsheets(): TypstExtension   // custom editor spreadsheets.editor (*.ic): a SpreadsheetView per panel; edits → applyChange
                                 // (file + typstPath); command spreadsheets.newSpreadsheet ("New spreadsheet…" in file/newFile)
// workbench/: new SpreadsheetView(panel.element, onEdit(path, { bytes, typst }))   .show(path, content)   .destroy()
// model/ (pure):
spreadsheetTypst(model, 'budget.ic') → Typst source   // `values` and `sheets` of the visible sheets
typstPath('/budget.ic') → '/budget.ic.gen.typ'
darkThemeVariables(color(token)) → { '--palette-…': color }   // IronCalc's theme variables for a dark widget
// workbench/color-scheme.ts:
followColorScheme(container, onDidChange) → Disposable   // sets / takes away the dark variables as data-scheme changes
```

- The view only reports edits; the extension's entry (`save`) decides what the project gets: the `.ic` file and,
  when it changed, its Typst file, both through `Workbench.applyChange`; a refusal is an error message ("budget.ic
  not saved: …").

- A spreadsheet is a project file `name.ic` (the custom editor's pattern `*.ic`), in IronCalc's own format
  (`Model.from_bytes` / `toBytes`): the browser package has no `.xlsx`. An empty file opens as a
  new workbook, which is saved at once: "New spreadsheet…" (the file panel's "New", menu `file/newFile`, command
  `spreadsheets.newSpreadsheet` with the row as argument) asks for a name (`.ic` added; in the row's folder),
  creates the empty file and opens it.
- `workbench/workbook.ts` is a separate chunk (`import()` from `spreadsheet-view.ts` on the first show; the
  folder's entry exports only its types): `@ironcalc/workbook` (React,
  i18next, lucide icons) and the engine's wasm. Its CSS (scoped `.ic-root`) goes into the
  container's root node (the shadow root of `<typst-editor>`); `rootContainer` keeps its menus
  inside the container.
- Edits: the UI changes the model itself. After user events in the container (keyup, pointerup,
  paste, …, 300 ms quiet) a non-empty `flushSendQueue()` means the model changed: `onEdit` gets
  `toBytes()` and `spreadsheetTypst`. The widget stores both through the usual file requests: the
  `.ic` file (a binary `update`) and `name.ic.gen.typ` (created or updated, only when it changed).
  (Projects from before keep their old `name.ic.json`; nothing writes it any more.)
- Typst: `#import "budget.ic.gen.typ": sheets, values`. Both are dictionaries by sheet name
  (visible sheets; `sheets.at("My sheet")` for names that are not identifiers):
  - `values.Sheet1.at(row).at(column)`: the displayed strings (e.g. "1,200.00"), A1 to the last
    cell with data, hidden rows and columns included (indices match the spreadsheet).
  - `#sheets.Sheet1`: a `table` with the column widths and non-default row heights (IronCalc's
    pixels × 3/4 as pt), alignment (as formatted; "general": numbers right, truth values and
    errors centered, text left; vertical bottom unless set), fill, font (bold, italic, underline,
    strike, colour, size relative to IronCalc's 12) and borders (thin/medium/thick widths,
    dotted/dashed). Hidden rows and columns are left out. Grid lines are Typst's table stroke
    (`#set table(stroke: …)`); the font family stays the document's.
  - Not carried over: merged cells (IronCalc 0.8 has no API for them), conditional formats,
    wrap / overflow into neighbouring cells, double borders (drawn as one thick line).
- `model/typst-file.ts` reads the model only through `SheetSource` (a slice of IronCalc's `Model`);
  its test runs the real IronCalc wasm and compiles the result with the Typst engine.
- Dark mode: IronCalc 0.8 has no dark theme, but its CSS and its grid canvas read ~60 custom properties
  (`--palette-*`, defaults on `.ic-root`; its `setThemeVariables` is not exported, so the extension sets them on the
  container itself). While the widget's `data-scheme` is `dark` (see "Dark mode"), `followColorScheme` sets
  `darkThemeVariables` there: the neutrals (cell background, grid lines, headers, default text, IronCalc's grey ladder
  for its toolbar, menus and dialogs) from the widget's `--te-*` tokens; IronCalc's orange accent and status colors
  stay; colors a file sets on cells stay. The canvas cannot resolve `light-dark(..)` / `var(..)`, so each token is
  resolved first (`getComputedStyle` of a hidden element colored `var(--te-x)` in the widget: an embedder's token
  overrides count). Light: the variables are removed, IronCalc's own apply. Set before the first render, and on every
  change of `data-scheme` (a MutationObserver; setting the same value is ignored).
  - The grid reads its colors only when its canvas object is built (`getComputedStyle` of `.ic-root` in the
    constructor), which the worksheet does on every render. A change is applied by a synthetic window `resize` (the
    worksheet's own listener re-renders it); re-rendering the `IronCalc` element instead would replace its
    `workbookState` and lose a cell being edited. The toolbar, menus and dialogs use the variables in CSS and change
    at once.
  - `spreadsheets.css` recolors, under `[data-scheme='dark']`, the few places IronCalc's CSS colors without its
    variables (the cell editor's white background, the sheet tab hover, the fill handle's border).
- Not yet: `.xlsx`, sharing spreadsheet edits in collaboration rooms (binary: the last save wins).

### Diagrams (`src/extensions/diagrams`)

Task: docs/todo/drawio-diagrams.md. A diagram is a `.drawio.png`: a PNG with the diagrams.net diagram's XML in it,
so Typst shows it as an image (`#image("flow.drawio.png")`) and diagrams.net edits it again.

```ts
diagrams(): TypstExtension   // setting diagrams.editorUrl (default https://embed.diagrams.net/); custom editor
                             // diagrams.editor (*.drawio.png, priority 110: over images.preview); command
                             // diagrams.newDiagram ("New diagram…" in file/newFile); box action "Edit diagram"
// model/ (pure):
new EmbedSession({ content, post(action), save(png), timers?, delay? })  .receive(message)  .flush()  .initialized  .content
embedUrl(base, { dark }) → URL           // embed=1, proto=json, spin=1, noSaveBtn=1, noExitBtn=1, saveAndExit=0, dark=0|1
readDiagramXml(png) → xml | null   writeDiagramXml(png, xml) → png   toDataUri(png)   fromDataUri(uri)   emptyDiagram()
// workbench/:
new DiagramEditor(panel.element, { path, content, editorUrl, save(png), failed() → Promise<boolean>, loadTimeout? })  .dispose()
newDiagram(project, workbench, resource?)
```

- **Protocol** (diagrams.net embed mode, JSON): the editor sends `init`, the session answers `load` with the file as
  `xmlpng` (a data URI; an empty file or no PNG: an empty `xml`) and `autosave: 1`. Every `autosave` (and `save`)
  asks for `export` as `xmlpng`, one at a time (changes during an export ask for one more when it returns); every
  exported PNG is saved `SAVE_DELAY` (800 ms) after the last one, through `Workbench.applyChange({ kind: 'update',
  content })` (the last export wins; a refusal is an error message). An export with the diagram the file holds
  already is not saved (the editor reports its loaded state). `flush` (the panel's `onDidDispose`: another file
  shown, destroy; a scheme change) saves the pending export at once and, if the diagram changed after the last
  export (the export did not come back in time), writes the newer XML into the last PNG: the diagram is never
  lost, its picture follows with the next export. Collaboration: binary files are not merged; the last save wins.
- **The view** only carries messages: those from its own iframe (`event.source`) to the session, the session's to
  the iframe as JSON (target origin: the editor's). Dark mode: `dark=1` while the widget's `data-scheme` is dark; a
  change of scheme flushes and loads the editor again with the file as last saved. Offline (`navigator.onLine`) or
  no `init` within 20 s: the status says the editor could not be loaded and an error message offers "Show as
  image", which replaces the iframe with the picture (read-only).
- **PNG round trip** (`png.ts`): the diagram is a `tEXt` chunk `mxfile` holding the URI-encoded XML, as diagrams.net
  writes it (it also reads `mxGraphModel`); writing replaces it, right after `IHDR`, with a fresh CRC; the picture is
  untouched. The empty diagram is a 1×1 transparent PNG with an empty one-page diagram.
- **"New diagram…"** asks for a name in the row's folder (the file's, or the folder itself), `.drawio.png` added
  (`flow`, `flow.drawio`), refuses existing names, creates the empty diagram and opens it.
- **"Edit diagram"** (`visualView.registerBoxAction`): on every box whose Typst links (the workbench's document links:
  the extension parses no Typst) to a diagram of the project, e.g. an image box's toolbar; it opens the diagram.

### Layout (`src/hosts/workbench/layout/layout.ts`)

```ts
new Layout(host, storageKey)   .editor  .preview  .statusBar   // the editing column, the preview column, the status bar
.addPanel(id, { label, icon }) → body element  .removePanel(id) // a side panel + its rail button
.setDefault(id, open)  .setAvailable(id, available)  .choose(id, open)  .isOpen(id)  .dismiss()
.remember<T>(name) → { load(), save(value) }               // sessionStorage `${storageKey}:${name}`, failures ignored
```

- One grid on the host: side (rail + open panel) | editing column | preview; the status bar
  (`Workbench.registerStatusBarItem`; `status-bar/StatusBar` places the items: a left and a right side, each by
  priority, higher further left; hidden while empty) spans all. The preview is a share of the widget (default half; the separator on its left edge
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
  (the file panel calls `SidePanel.dismiss()` after a file was chosen in it).

### Dark mode (`src/typst-editor/typst-editor.css`, `src/extensions/typst-language/source-view/code-colors.ts`, `src/ui/color-scheme/`)

- **Tokens.** Every color of the widget's stylesheets is a custom property on `.typst-editor`
  defined as `light-dark(light, dark)` (`--te-bg`, `--te-surface`, `--te-subtle`, `--te-text`,
  `--te-muted`, `--te-accent`, …). New CSS, the extensions' too, uses them;
  `stylesheets.test.ts` fails on a hex color outside a token definition (exceptions: the vendored
  ProseMirror CSS, the fallback of a collaborator's color).
- **Which one.** CSS `color-scheme` decides: by default the page's (inherited, also into
  `<typst-editor>`'s shadow root), so the widget is light unless the page declares dark, and a page
  with `color-scheme: light dark` gets it dark when the OS is. The setting `workbench.theme` (`light` | `dark` |
  `auto`, default null: as the page) sets `data-theme` on the host, which the stylesheet turns
  into its own `color-scheme`; a change of the setting applies at once (`ColorScheme.update`).
- **`data-scheme`** (`ColorScheme`, `src/hosts/workbench/color-scheme/color-scheme.ts`): the scheme the widget's
  colors resolved to (`light` | `dark`, from its computed text color: `isLightText`, `ui/color-scheme/`), for what light-dark() cannot
  express. With it dark, the preview shows the pages inverted like dark-mode PDF readers do
  (`filter: invert(1) hue-rotate(180deg)` on `.typst-preview__content`, pictures inside turned
  back; the overlays beside it keep their colors), and so are compiled snippets in the Visual view
  (image files not). The PDF export is unaffected. IronCalc's workbook UI gets a dark palette from the tokens (see "Spreadsheets").
- **CodeMirror** (Source view and raw boxes): `codeColors` = CodeMirror's default highlight style
  with its colors from `--te-syn-*` tokens, plus `EditorView.darkTheme` (cursor, selection, gutters,
  panels, tooltips) switched on when the text around the editor resolves light.
  It checks when the view is placed or resized, when the OS scheme changes and when the widget's `data-scheme`
  changes (a `MutationObserver`; `ColorScheme` at creation, on OS changes and on `workbench.theme` changes), so a page switching its own color-scheme later changes the tokens at
  once, CodeMirror's own chrome at the next resize, and the preview's inversion not until reload.

### File panel (`src/extensions/files`)

```ts
files()  fileNavigation(): TypstExtension   // the side panel, the frame links (images / data files: the images extension)
// setting files.panel: 'auto' | 'show' | 'hide' (default auto)
// commands (each on a row, default: the focused one): files.newFile, files.newFolder, files.upload, files.rename, files.delete
// menus: file/newFile ("New" in the header), explorer/context (a row's context menu); context
//        { view: 'files', resource, resourceKind: 'file' | 'folder', resourceIsMain }, argument: the row
// workbench/:
new FilePanel(parent, { onOpen(path), onChange(change) → Promise<reason | null>, prompts (the workbench's input box,
  warning and error messages), menus: { items(menuId, context), run(command, resource) }, memory?, decorations?(path) }, state)
.render({ paths, main, active })  .newFile(at?)  .newFolder(at?)  .upload(at?)  .rename(path?)  .delete(path?)
.uploadFiles(files)  .current()  .context(path)  .destroy()
// workbench/tree/: new FileTree(parent, { onOpen, onRename, onDelete, onMove(source, folder), onUpload(files, folder),
//                  onContextMenu(path, anchor), memory? })
// workbench/icons/: icon(doc, name) — a leaf folder, so the tree and the panel both take it from below
// model/ (pure): buildTree(paths, emptyFolders), visibleRows(tree, expanded), navigate(rows, current, key),
//                relocate(paths, source, target) → renames, filesUnder, folderOf, ancestorsOf; uploadChanges
```

- **Only gestures → `FileChange`s** (names via `ProjectPath.fromName`: any folder depth, default extension).
  Names are asked in the workbench's input box (`validateInput`: an unusable or taken name says so while typing;
  a new name starts with the row's folder, `chapters/`; a rename selects the name without the extension, as VS
  Code), a delete is confirmed by a warning message with "Delete", refusals are error messages. A gesture that
  needs several changes (a folder's rename / move / delete: one per file) asks for them in order and stops at
  the first refusal.
- **Menus, not buttons**: the panel's operations are the extension's commands, offered through two menus any
  extension may add to (e.g. "New diagram…"): "New" (`+`, `aria-haspopup=menu`; hidden while `file/newFile` has no
  entries) opens `file/newFile` for the focused row; a right click, Shift+F10 or the context menu key opens
  `explorer/context` for the row (`ui/popup-menu`; nothing opens while no entry applies). The built-in entries:
  New file…, New folder…, Upload files… (both menus, group `navigation`), Rename… and Delete (context menu, group
  `modification`, `when: !resourceIsMain`).
- **Tree**: folders first, then files, both by name (`Intl.Collator`, numeric). `role=tree`, one
  `treeitem` per visible row (`aria-level`, `aria-expanded`, `aria-selected` on the shown file;
  roving tabindex). Open folders are remembered (`memory`, the Layout's session store); the
  folders around the shown file open when it changes. The files' decorations (`Workbench.getFileDecorations`, from
  every `FileDecorationProvider`, e.g. who else is in a file) as badges in their color, and on a closed folder the
  propagating ones of the files inside (each once); drawn again on `onDidChangeFileDecorations`.
- **The focused row** (click, keyboard, right click; else the shown file) is what F2 / Delete and
  "New" act on: a new file, folder or upload goes into its folder. The main file and a folder
  holding it cannot be renamed, moved or deleted.
- **Empty folders** exist in the panel only (the project has no folders), until a file goes in.
- **Drag & drop**: a row dragged onto a folder row (or a file row: its folder; empty space: the
  top level) is relocated there; files from the computer dropped on a row are uploaded into that
  folder (the tree stops the drop, so the widget-wide handler does not upload them again).

### File links (`src/core/typst-syntax/`, `src/hosts/workbench/document-links/`, `src/extensions/document-links/`)

```ts
// core/typst-syntax (Typst syntax only)
findFilePaths(text, { from?, to? }) → PathInSource[]   // { path: PathReference, from, to, call }; call: import | include | image | …
readingOrder(read, main) → ProjectPath[]              neighbours(read, main, path) → { previous, next } | null
// the workbench (see "Extensions")
workbench.registerDocumentLinkProvider({ provideDocumentLinks({ path, text }) → DocumentLink[], resolveDocumentLink?(link) },
                                       { priority? }) → Disposable
// DocumentLink { range: {from, to}, target?: ProjectPath, tooltip?, command?: Command { title, command, arguments? } }
linkExtension({ path(), provideDocumentLinks, resolveDocumentLink, open(target), executeCommand(id, ...args) })
  → CodeMirror extension   // hosts/workbench
// extensions/document-links
documentLinks(): TypstExtension                       // one provider: the file paths of a text; command documentLinks.createFile(path)
```

- **One definition** of what a path reference is (`findFilePaths`; Lezer, `codemirror-lang-typst`): the string of
  `import "…"` / `include "…"` and the first positional string argument of `image`, `read`,
  `json`, `csv`, `yaml`, `toml`, `xml`, `cbor`, `bibliography` (also the strings of a
  bibliography array); escapes decoded; packages (`@…`), empty strings, named arguments, computed
  paths and methods (`image.decode`) are not references.
- **Links are VS Code's** (decided 2026-10-10): any extension registers a `DocumentLinkProvider` with the
  workbench; both views show the links of all of them, merged (overlapping ranges: the higher `priority` wins;
  equal: registered first). `provideDocumentLinks` is cheap (ranges); `resolveDocumentLink` fills in `target`,
  `tooltip` and `command` when a link is hovered or followed (the workbench remembers each link's provider).
- **The `documentLinks` extension** is one provider: a path's link resolves from its file's path; an existing file
  is its `target`; a missing one gets the tooltip "x is not in the project", and a missing `.typ` file the command
  "Create x" (VS Code's `Command`: `documentLinks.createFile(path)`, a `create` change through
  `Workbench.applyChange`, then `open`; rejects with the host's refusal); a
  path leaving the project resolves to nothing (marked, but no hover).
- **Source view and raw boxes** (`linkExtension`, registered by the workbench host with every Source view and, through
  `registerBoxCodeExtension`, every raw box's code; the text's path is its file's, a box's text is its code): links
  are marked (`typst-source__path`, underlined on hover, a pointer while Ctrl/⌘ is held: `typst-source--mod`);
  Mod+mousedown on one opens its target (else CodeMirror's own Mod+click); Alt+Enter opens the target of the link
  holding the cursor (F12 was avoided: browsers take it for the developer tools); the hover (`linkInfo`) offers
  "Open x (Ctrl+click or Alt+Enter)", shows the tooltip, and a button that runs the command
  (`executeCommand(command, ...arguments)`) and shows the rejection's message.
  The links are computed again on every change of the text.
- **Image boxes**: the `images` extension shows an image box's path as the first link in its code
  (`Workbench.provideDocumentLinks` + `resolveDocumentLink`): a button opening the target, or the path marked
  missing with the link's tooltip.
- **Workbench**: `open` shows the file (the panel selects it and opens its folders).

### Diagnostics in the widget (`src/extensions/diagnostics`)

```
diagnostics.ts         the extension: preview.onDidChangeDiagnostics → DiagnosticCollection, status
model/                 DiagnosticCollection (VS Code's name: set(document, diagnostics), get, onDidChange),
                       SourceDiagnostic, describeDiagnostic, summarizeDiagnostics
source-view/           lint(collection): the Source views' CodeMirror lint
visual-view/           diagnosticHighlight: a diagnostic as the Visual view's Highlight
workbench/             DiagnosticsStatus: the status bar item
```

`summarizeDiagnostics(diagnostics, file)` (pure, unit-tested) splits a compile's diagnostics into
those of the shown file and those elsewhere (other files, packages or no location: only listed),
and computes the status label ("✓ compiled" / "1 error, 2 warnings") and the jump target
(`{path, from, to}`: earliest error in the shown file, else in another project file, else the
same for warnings). `DiagnosticsStatus` (the `diagnostics` extension: a status bar item, left, priority 100, for the Typst file
shown last, from the preview's `onDidChangeDiagnostics`) renders it below both panes; clicking the
label, or a listed diagnostic of a project file, opens that file and reveals the range in the
source view, switching to the Source tab. Hovering or focusing the label lists the shown file's
messages (with hints), each jumping to its range. Every document's views get the diagnostics of
their own path from the one `DiagnosticCollection`: the Source view as CodeMirror lint (underline + hover,
`@codemirror/lint`, which maps them through later edits; those set before a view exists show when it is made), the
Visual view as the `diagnostics` highlight layer (`registerHighlights`, `diagnosticHighlight`: (wavy underline, message + hints as tooltip; raw code boxes in range
are outlined, since inline decorations skip block atoms; an empty range marks one character)). `describeDiagnostic`
words a diagnostic (message, then `hint: …` lines) for every view.

### Comments = margin notes (`src/extensions/comments`)

Comments are [`drafting`](https://typst.app/universe/package/drafting/) margin notes in the
Typst source itself (`@preview/drafting:0.2.2`): `#margin-note[note]` (point, at a cursor) and
`#margin-note[text][note]` (range: drafting highlights `text`). There is no other comment store:
the preview shows what the compiler draws, and git, diffs, undo and collaboration carry notes as
ordinary text. A thread is a list in the note (one item per message, `*Name* (YYYY-MM-DD): text`,
below), resolving means deleting the call, and an author is whatever the note's text says (the
widget's `user.name` when it writes a message). The PDF download leaves notes out on request
(`withoutNotes`, below).

```ts
// model/ (pure)
// margin-note-syntax.ts: the only module that knows drafting's call syntax
parseNoteCall(src) → {head, text?, note} | null     // head: `#margin-note` plus any `(..named)`
printNoteCall({head, text?, note}) → string         // printNoteCall(parseNoteCall(src)) === src
noteCallSyntax(source, funcCallNode) → {head, text: ContentBlock | null, note} | null   // in a parsed tree
isNoteCallAt(source, from, to) → boolean            // one note call in markup from `#` to exactly `to`
safeNote(markup) → string | null                    // markup that cannot end or swallow its call
addMarginNote(text, {from, to}) → {changes: TextChange[], note} | null   // note: offset of the new (empty) body
NOTE_STYLE                                          // the set-margin-note-defaults(..) call added with a new import
withoutNotes(files, main) → PdfEntry                // the PDF without comments: entry + replaced/added .typ texts
// note-thread.ts: the only module that knows the thread format (all on the note's markup)
readThread(note) → {author, date, text}[]          // author/date null: an anonymous message (markup)
addReply(note, {author, date, text}) → note        // only an insertion after the last item
editMessage(note, index, text) → note | null   deleteMessage(note, index) → note | null ('' = the only one)
localDate(date?) → 'YYYY-MM-DD'
layoutCards([{anchor, height}], {gap, active?, top?}) → tops   // card-layout.ts: cards beside anchors, no overlap

// comments.ts, the entry
comments(): TypstExtension   // signs as Workbench.user; registerAddComment + registerIncludeComments + marginNotes + notesGutter

// workbench/
registerAddComment(workbench, cards: { editNote(document, offset) }) → Disposable
                                     // command comments.addComment, Mod+Alt+KeyM, the Source view's tab-bar button
new CommentAction(doc, () => {document, view: {selection(), reveal(), editNote?()}} | null)   .button  .comment()  .destroy()

// preview/
registerIncludeComments(preview, project) → Disposable
                                     // PDF export option comments.include (default off): off → withoutNotes of the
                                     // project's files overlaid with the entry's sources; on → the entry as it is

// visual-view/
marginNotes({ comment? }) → VisualViewContribution  // marginNote + noteRange specs; "Comment" in the toolbar and
                                     // the selection's bar (runs comments.addComment)
notesGutter({user?}) → { activate, editNote(document, offset) → boolean }   // registers a gutter per Visual view;
                                     // editNote focuses the reply box in the card of the note whose source holds offset
new NotesGutter(body, {user?})   .plugin (add to the editor state)  .edit(offset) → boolean  .destroy()
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
- **`CommentAction`** (`workbench/`): "Comment" and Ctrl/Cmd+Alt+M (the command
  `comments.addComment`, bound with `registerKeybinding`: captured at the widget root). The Visual
  view's toolbar has the button (`marginNotes({ comment })` runs the command);
  the tab bar has it for the Source view only (an `editor/title` menu entry with `when: editorMode ===
  'source'`, group `navigation`, its icon). Works on the
  shown `.typ` file in the current tab (`Workbench.activeTextEditor`), applies the edits as one
  `document.change`, then in the Visual tab the notes gutter's `editNote(document, note)` (the extension owns
  the gutter) focuses the new note's reply box, or the Source view puts the caret into `[]`.
- **Visual view, in the text** (`visual-view/margin-notes.ts`): see `marginNote` / `noteRange` below. A point
  note is a small marker (tooltip: its note), a range note's text is highlighted.
- **Visual view, notes gutter** (`visual-view/notes-gutter/`, like the comment sidebar of Google Docs or
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
  - Layout (`model/card-layout.ts`, pure): cards start at their anchor's top, pushed down below the
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
- Tests: `model/note-thread.test.ts` (format, round trips, escaping, concurrent replies over Y.Docs),
  `visual-view/margin-notes.test.ts` (projection, printing, the toolbar action),
  `visual-view/notes-gutter/notes-gutter.test.ts` (cards and threads in jsdom), `preview/preview.test.ts` (the PDF
  export option), `workbench/comment-action.test.ts`.
- Engine tests (`model/drafting.test.ts`) compile both note forms, both thread layouts, page margins and the
  sources without notes against the real package (`src/extensions/comments/model/fixtures/drafting-0.2.2`).
- **Removed** with this design (it replaced the sidecar comments of docs/todo/comments.md):
  `src/comments` (Comments, quote anchors, CommentsPanel, CommentsUI), `SharedComments` and the
  Y.Doc `comments` map, `Preview.setMarkers` / `PreviewMarkers`, the widget options `comments` /
  `onCommentsChange`, the `comments` getter/setter, the element's `.comments` and
  `commentschange`, and the `CommentsData` / `TypstEditorCommentsChangeDetail` types.

### Collaboration (`src/extensions/collaboration`, `src/extensions/source-control`, `server/`)

```
collaboration.ts        eager entry: collaboration(options) (the extension; the user is Workbench.user; not a built-in:
                        the host adds it, see "createTypstEditor")
collaboration-link.ts   CollaborationLink: import()s model/ on demand, publishes the selection, reports the places
presence/               eager, pure: Presence, PlacedPresence, PresenceSource, Presences (everyone's places), initials
remote-origin.ts        REMOTE_ORIGIN: the origin of the changes that arrive through a Y.Text (eager, a leaf)
model/                  the lazily loaded chunk (Yjs, Hocuspocus; no DOM): Collaboration (model.ts), SharedProject,
                        TextBinding (a TypstDocument bound to its Y.Text; y-delta.ts), SharedAssets, RemoteCursors, GitLabSourceControl (their protocol: core/gitlab-protocol, also
                        the server's)
source-view/            sourcePresence: carets + selections in a CodeMirror editor (remotePresence, setPresence);
                        perUserUndo (other users' edits out of the Source views' undo history);
                        caretElement, presenceStyle (the caret's DOM, also the Visual view's)
visual-view/            visualPresence: selections as highlights, carets and box outlines (an editor extension),
                        boxPresence for raw boxes' code
workbench/              presenceDecorations: a FileDecorationProvider (who is in which file)
```

```ts
createTypstEditor(host, { …, user?: {name, color?},
  extensions: (builtins) => [...builtins, collaboration({ doc: Y.Doc, awareness?: Awareness } | { url, room, token? })] })

Collaboration.start(options, { project, user }) → Promise<Collaboration>   // url: waits for the first sync
.setCursor(path | null, range?)   .destroy()
.onDidChangePresence: Event<PlacedPresence[]>      // everyone else, in every file, once per change
.sourceControl → GitLabSourceControl | null   // GitLab rooms: a workbench SourceControl (commit(message), state)

new Presences(pathOf)   .set(placed)   .presencesIn(document)   .presencesAt(path)   .onDidChange
```

**Only text is shared** — ProseMirror/Tiptap and CodeMirror never sync directly; they keep
following their `TypstDocument`. One Y.Doc per project (= Hocuspocus room):

| Y.Doc entry | Content | Kept in step by |
|---|---|---|
| `files` (`FILES_MAP`): `Y.Map<path, Y.Text>` | the text of every `.typ` file | `SharedProject`; read and merged by `GitLabRoom` |
| awareness state | `user: {name, color}`, `cursor: {path, anchor, head}` (relative positions) | `RemoteCursors` |
| `assets`: `Y.Map<path, sha \| Uint8Array>` | GitLab rooms only: the other files (blob sha, or uploaded bytes not committed yet) | `SharedAssets` (clients), `GitLabRoom` (server) |
| `meta`: `Y.Map` | GitLab rooms only, written by the server: `baseSha`, `base` (path → text), `baseAssets` (path → sha), `lastCommits` (path → commit) | `GitLabRoom`; read by `GitLabSourceControl.isGitLabRoom` |

- **`SharedProject`**: binds each project document to its Y.Text (a `TextBinding` each) and
  keeps the *set* of files in step: local create / rename / delete (and `sync()` after
  `Project.replace`) write the map in one transaction; remote map events become
  `Project.apply(…)` (one delete + one add in one transaction = rename). Joining: the shared files
  win, local files the room lacks are seeded. If two clients seeded a key concurrently, the loser
  rebinds to the winner's Y.Text (one remote change; views survive). A rename is a new
  Y.Text (its Yjs history starts over); the renaming client keeps its document and views.
- **`RemoteCursors`** owns awareness and the Y relative positions: publishes the local selection
  and resolves the others' into `PlacedPresence`s (`{id: clientID, user: {name, color}, anchor, head, path}`,
  source offsets) once per microtask after any change of the shared texts (Y.Doc `update`) or of presence;
  `Collaboration.onDidChangePresence` gets everyone in every file, only when that changed. Colors: the user's, else a palette entry by
  name; flag text black or white by WCAG contrast (`textColorOn`, `ui/color-scheme`). CSS: `--typst-remote-color`,
  `--typst-remote-text`.
- **Presence out of the hosts** (decided 2026-10-10): the hosts know no presence. The extension keeps everyone's
  places in its own `Presences` and draws them itself through generic contribution points, in every view of every
  file (hidden ones too, so a tab switch shows them at once): a CodeMirror extension in the Source views
  (`sourcePresence`); highlights for selections, an editor extension for carets and box outlines (using the view
  context's `sourceToPos` / `posToSource` / `isBox`) and a box code extension in the Visual views
  (`visualPresence`); and a `FileDecorationProvider` (`presenceDecorations`: initials in the user's color, the
  name as tooltip, propagated to closed folders), which the file panel shows. Not the preview (decision
  2026-10-10: carets there were noise; the preview is the output).
- **Why not Tiptap's Collaboration / CollaborationCaret** (decision): they are built on
  y-prosemirror, which makes the ProseMirror document the shared truth (a Y.XmlFragment). Here
  the Typst text is the truth (one Y.Text per file) and the Visual view is a projection of it;
  syncing ProseMirror trees would bypass the projection (raw boxes, pristine source, Source
  view and preview all follow the text). So the sync stays text-based and only the *look* of the
  carets follows Tiptap / y-codemirror.
- **The `collaboration` extension (`collaboration.ts` + `CollaborationLink`, outside the chunk)**: registers the
  presence drawing and decorations, registers a GitLab room's source control once connected, and `import()`s
  `model/model.ts` on demand
  (own chunk, ~37 kB gzip
  with Yjs and the Hocuspocus provider), publishes the selection when the editing views report a change
  (`Workbench.onDidChangeTextEditorSelection` → `selectionChanged()`, once per microtask, while focus is in the
  editing area (`Workbench.isEditorFocused`);
  not on the DOM's `selectionchange`, which fires before CodeMirror/ProseMirror read the new
  selection and so published the previous one).
- **Server (`server/`)**: `collabConfiguration({ storage?, database?, authenticate?, debounce?, gitlab?, extensions? })`
  → Hocuspocus configuration; `createCollabServer({ port, … })`. Storage keeps every room's Yjs
  state (`onLoadDocument` / `onStoreDocument`; default `@hocuspocus/extension-sqlite`).
  `onAuthenticate` calls an `Authenticate(token, room) → {name?, email?}` check; the stub
  `sharedToken(TYPST_COLLAB_TOKEN)` allows all when unset. The server looks inside the Y.Doc
  only in GitLab rooms.

#### GitLab-backed rooms (`server/src/gitlab`, `src/extensions/collaboration/model/gitlab-source-control.ts`, `shared-assets.ts`, `src/extensions/source-control`)

A room named `gitlab:<project id or path>@<branch>` is that branch (`parseRoomName`). The server
config (`gitlab: {url, token, webhookSecret?, authorEmail?, fetch?}`, from `TYPST_GITLAB_*` in
`main.ts`) holds the only GitLab token. Protocol (`src/core/gitlab-protocol/gitlab-protocol.ts`, with the
Y.Doc's map names `FILES_MAP`, `ASSETS_MAP`, `META_MAP`):

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
  `GitLabSourceControl` (a workbench `SourceControl`, VS Code's shape: `commit(message)` sends `gitlab:save` as the
  collaboration `user` over the provider's stateless channel; `state` is `busy` until the answer and `status` the
  outcome as a message (`commitStatus`: "Saved version 01234567 (Ann)", "Merged new changes from GitLab", "No
  changes to save": info; a conflict: warning; "Saving failed: …": error), also for other clients' saves and
  upstream merges) and `SharedAssets` (assets ↔ project's other files; repository files
  fetched from the files endpoint, uploads as bytes; bytes → sha after a commit is not a
  change). The extension registers the source control with `Workbench.registerSourceControl`; the
  `source-control` extension (only the UI over registered source controls) puts "Save to GitLab…" ("Saving to
  GitLab…" while busy) into the tab bar's menu (`editor/title`, command `sourceControl.commit`: the commit message
  in the input box, the default offered; several source controls: a quick pick first) and tells each new status as
  a message of its severity, to everyone in the room.

### Demo playground (`demo/`, `server/src/playground`)

`mise run demo` = Vite + `server/src/fake-gitlab-main.ts` (plain rooms, and GitLab rooms against
an in-memory `FakeGitLab` holding `demo/examples/advanced`). Checklist with steps per feature:
[docs/demo-playground.md](docs/demo-playground.md).

- **State is the URL** (`demo/playground.ts`): `example`, `room` (none → Local, `gitlab:…` →
  GitLab, else Collaborate), `user` (put into the URL in a room, default Ann; the bar's second
  window link uses the next name). `editorOptions(state, server)` → `files` / `collaboration`: GitLab mode passes no local files; no server →
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
| `mise run fixtures:packages` | packs every test package `src/**/fixtures/<name>-<version>/` into `.tar.gz` (committed); each lives next to the tests using it: greet (`core/typst-packages/`), drafting (`extensions/comments/model/`), cheq (`extensions/lists/model/`, `cheq.test.ts`) |
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
- **GitLab rooms:** conflicts are reported (a warning message), not highlighted in the views yet;
  an asset changed on both sides keeps the room's
  version and overwrites upstream on save; GitLab-side renames are seen as delete + create; no
  GitLab sign-in yet (the token check is the stub, the author's name comes from the client); the
  room's main file must exist in the repository (else the widget's empty main is committed).
  `{ doc }` mode has no source control.
- **Collaboration:** images and other non-`.typ` files are not shared (outside GitLab rooms). `{ doc }` mode needs the
  widget and the host on the same Yjs instance (`dist/lib` bundles its own Yjs). In `{ doc }`
  mode the host must pass a synced Y.Doc; with `{ url }` an unreachable server leaves the widget
  local. In the Visual view a caret inside hidden markup (delimiters,
markers, blank lines) is drawn at the visible spot before it (the end of the line it ends), so a
caret at the end of a line never jumps to the start of the next one.
