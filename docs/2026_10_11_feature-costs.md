# What do features cost?

Snapshot of `task/api-extensibility` at `51d965f`, 2026-10-11. Analysis only; the basis for deciding what to
simplify or cut.

**How measured**
- LOC: TypeScript code lines (no blank or comment lines) in `src/<module>/`; CSS separately; tests = `*.test.ts`
  in the module.
- Complexity: the ESLint rules of `mise run quality:report` (thresholds forced to 0) over non-test code. Σcog =
  summed cognitive complexity; hot = functions with cognitive ≥ 7 or cyclomatic ≥ 8 (the gate is 12 / 10 and
  nothing exceeds it); worst = highest cognitive (cognitive/cyclomatic).
- Deps: modules imported (hosts / core / ui), contribution points called (`register…`), runtime couplings (schema
  names, commands, settings), third-party packages beyond Tiptap / CodeMirror / Lezer basics.
- E2E: `tests/e2e/*.spec.ts` exercising the module (by selectors, commands and spec topic; tests per spec in
  brackets).
- Totals: extensions 8.5k TS + 0.7k CSS, 6.7k test; hosts 5.0k + 0.5k CSS, 2.6k test; core 0.9k, 1.0k test;
  `typst-editor/` 0.1k + 1.6k test (whole-widget tests); server 1.4k + 0.7k test (raw lines).

## Extensions and hosts, most expensive first

| # | Module | TS / CSS / test LOC | Complexity: Σcog, hot, worst | Dependencies | Unit test files | E2E specs | What makes it expensive |
|---|---|---|---|---|---|---|---|
| 1 | ext `comments` | 1300 / 122 / 1272 | 291 (highest), 18, `lineKind` 11/9 | 11 modules (incl. `hosts/commands` directly, `preview`, `projection`, `typst-engine`); 10 points (`registerNode`, `registerMark`, `registerGutter`, `registerKeybinding`, `registerPdfExportOption`, menu, toolbar group …) | 11 | margin-notes (9), pdf-download, collab | Own Typst text format (`note-thread.ts`, 300 lines), page-margin rewriting as a drafting 0.2.2 workaround, a notes gutter with card layout (359 + 242 lines). Only user of 4 contribution points. |
| 2 | ext `collaboration` (+ `server/`, `core/room-protocol`) | 920 / 63 / 820 (+ server ~1.4k / 0.7k) | 159, 5, `SharedProject.pull` 9/9 | 12 modules, both views + window + workbench; 7 points (only user of `registerFileDecorationProvider`, `registerSourceControl`); yjs, y-protocols, @hocuspocus/provider | 12 | collab (7), gitlab (4), demo-playground | Touches every view (presence in Source and Visual), a server, GitLab rooms with merge / commit / fake GitLab. E2E needs a running server. Not a builtin (host adds it), lazily loaded. |
| 3 | host `visual-view` | 1193 / 182 / 555 | 145, 2, `addProseMirrorPlugins` 8/6 | `projection`; used by 16 extensions | 6 | all 13 `visual-*` specs | Raw boxes (333 lines), toolbar + text-style menu, node views; the biggest contribution surface (nodes, marks, toolbar, gutter, box renderers / actions, highlights). |
| 4 | host `workbench` | 963 / 132 / 736 | 118, 4, `layout` 9/10 | imports 15 modules (every other host); used by all 26 extensions | 8 | all | `workbench.ts` 504 lines; layout heuristics (`layout`, `choose`, `placeFrame` are hot); composes the namespaces. |
| 5 | host `projection` | 902 / 0 / 90 | 191 (densest: 0.21 per line), 10, `runBlock` 10/8 | used by 9 extensions + `visual-view` | 1 (+ 20 extension / widget test files) | all `visual-*` | The Typst ↔ ProseMirror parser / serializer / position mapping. Most hot functions of any module, but tested almost only through extensions. |
| 6 | host `window` | 772 / 102 / 406 | 106, 6, `toRegexSource` 11/8 | used by 10 extensions | 6 | files-tree, multi-file-ui, diagrams, spreadsheets, text-files | Own quick-input (369 lines), notifications, save dialog, custom editors with a filename-pattern compiler, status bar, file decorations. |
| 7 | ext `images` | 739 / 89 / 366 | 116, 1, `parseArgs` 6/6 | 11 modules; 6 points (only user of Tiptap `registerPlugin` at runtime); calls figures' Tiptap commands (`can().addFigureCaption`) | 10 | image-upload (3), visual-figures, visual-compiled-boxes | Image node + resize tools (213 lines) + insertion / drops / uploads + asset viewer (custom editor) + image path links. Coupled to `figures` and `figureBody`. |
| 8 | ext `files` | 703 / 110 / 535 | 128, 6, `FilePanel.request` 7/7 | 8 modules incl. `ui/popup-menu` (its only user), `core/uploads`; 5 commands; only user of `registerSidePanel`; setting `files.panel` | 3 | files-tree (10), multi-file-ui (5), image-upload, web-component | Own tree widget (292) + panel (282) + tree model; knows other extensions' file endings for icons. Few unit test files for its size. |
| 9 | ext `labels` | 703 / 56 / 624 | 136, 1, `LabelIndex.rescan` 6/6 | 8 modules; reads node names `figure`, `heading`, `table` (other extensions') to suggest prefixes | 6 | visual-references (5) | Project-wide label index + scan, label tags (222), `@` suggestion list (194), reference hints. |
| 10 | host `preview` | 651 / 61 / 403 | 83, 2, `byPlacement` 8/6 | `typst-engine`, `typst-packages`, `engine-assets`; used by 4 extensions | 7 | preview (7), preview-ux (7), pdf-download, fonts, dark-mode | Worker, page list, overlays, snippets. Carries the real weight of `core/typst-engine`: 22 MB wasm + 9.3 MB fonts, 0.7k lines Rust. |
| 11 | ext `diagrams` | 446 / 7 / 312 | 71, 3, `readDiagramXml` 7/5 | 7 modules; only user of `registerBoxAction`; setting `diagrams.*`; runtime: `https://embed.diagrams.net/` iframe | 4 | diagrams (2) | Depends on a third-party service at runtime (network, embed URL parameters still unverified); PNG chunk parsing; embed session protocol. |
| 12 | ext `spreadsheets` | 396 / 7 / 236 | 60, 2, `text` 8/9 | 4 modules; @ironcalc/wasm + workbook, react, react-dom | 3 | spreadsheets (2; dark mode failed in the last local run) | Small code, heavy payload: lazily loaded `workbook` chunk 734 KB + 2 MB IronCalc wasm (demo build), React only for this. Theme palette mapping. |
| 13 | ext `markup` | 373 / 43 / 99 | 42, 2, `fencedText` 5/6 | 5 modules; @tiptap/extension-code(-block) | 3 | visual-links-tables, visual-toc-and-code, visual-toolbar | Many small constructs (bold, italic, code, code block, quote, link + link prompt). Low test LOC for its size. |
| 14 | ext `styles` | 376 / 20 / 313 | 53, 2, `calculateNewStyleChange` 8/8 | 9 modules; `registerTextStyleProvider` (shared with headings) | 4 | custom-styles (2) | Scans `#show`/`#let` styles from the project, style node + mark, "new style" source edits. |
| 15 | ext `headings` | 332 / 18 / 219 | 85, 3, `splitArgs` 7/7 | 5 modules; command `headings.toggleNumbering` (no UI); reads `rawBlock` | 5 | visual-toolbar, visual | Hand-written numbering-pattern parser and `#set heading` argument splitting. |
| 16 | ext `diagnostics` | 248 / 76 / 200 | 30, 0, `firstTarget` 5/4 | 8 modules; @codemirror/lint; only user of `registerStatusBarItem` | 5 | preview (errors), multi-file | Cheap per line; spans Source view (lint), Visual view (highlights), status bar. |
| 17 | ext `alignment` | 311 / 0 / 290 | 63, 4, `setRules` 10/6 | 4 modules; Tiptap global attributes on `paragraph`; tables' cells accept it (`blockContainer`) | 3 | visual-text-align (5) | `#set align` / `#align` rule rewriting; shares structure with tables. |
| 18 | ext `tables` | 281 / 7 / 282 | 64, 5, `tableArgs` 9/7 | 4 modules; @tiptap/extension-table; joins `figureBody` | 2 | visual-links-tables, visual-tables-real-world (4), visual-inline-boxes | Highest hot count among constructs: table argument / style projection and printing. |
| 19 | ext `pdf-export` | 212 / 29 / 214 | 26, 0, `makeAndSave` 4/4 | 7 modules; command `pdfExport.export` (called by the widget's `exportPdf`); setting `pdfExport.download` | 2 | pdf-download (3), web-component | Simple; options popover. |
| 20 | ext `lists` | 213 / 5 / 158 | 25, 0 | 4 modules; @tiptap/extension-list; reads `rawBlock` (checklist preamble) | 4 | visual-block-nodes, visual-toolbar | Task lists need a checklist preamble edit in the source. |
| 21 | ext `figures` | 198 / 9 / 59 | 33, 1, `addCaption` 5/7 | 4 modules; defines `figureBody` (images, tables join); its commands are called by images | 1 | visual-figures (4), visual-tables-real-world | Coupling hub (images, tables, labels); thin tests. |
| 22 | host `languages` | 181 / 16 / 132 | 28, 0 | used by 3 extensions | 2 | files-tree, multi-file | Link provider merge + link tooltip extension. |
| 23 | ext `page-layout` | 137 / 14 / 53 | 8, 0 | 4 modules | 1 | visual-block-nodes | Page break + horizontal rule. Cheap. |
| 24 | ext `text-files` | 114 / 12 / 139 | 14, 0 | 4 modules; codemirror | 2 | text-files (2) | Cheap. |
| 25 | host `workspace` | 124 / 0 / 92 | 25, 0 | used by 5 | 1 | web-component | Settings + `applyEdit`. |
| 26 | host `source-view` | 117 / 1 / 102 | 14, 1 | used by 2 extensions | 1 | preview, collab | Thin CodeMirror host. |
| 27 | ext `typst-language` | 117 / 0 / 51 | 16, 1, `closesAt` 8/8 | 2 modules; @codemirror/language, @lezer/highlight | 2 | none dedicated | Highlighting + bracket logic. |
| 28 | ext `preview-sync` | 86 / 32 / 18 | 8, 0 | 4 modules; setting `previewSync.followCursor` | 1 | preview, preview-ux | Cheap code, but 18 test lines for two directions of sync. |
| 29 | ext `source-control` | 72 / 0 / 109 | 15, 0 | `scm`, `window`; command `sourceControl.commit` | 1 | gitlab | Useless without collaboration's GitLab `SourceControl`. |
| 30 | ext `preview-controls` | 70 / 2 / 75 | 6, 0 | `preview` | 3 | preview-ux | Cheap. |
| 31 | host `commands` | 69 / 0 / 83 | 10, 0 | used by 4 | 1 | indirect | `registerKeybinding` used only by comments. |
| 32 | ext `rendered-boxes` | 66 / 1 / 170 | 6, 0 | 5 modules | 3 | visual-compiled-boxes (6), visual-inline-boxes (4) | Cheap code, broad e2e. |
| 33 | ext `file-navigation` | 49 / 5 / 29 | 7, 0 | only user of `registerEditorFrame` | 1 | files-tree | One feature, one contribution point of its own. |
| 34 | ext `document-links` | 43 / 0 / 54 | 5, 0 | `languages`; command `documentLinks.createFile` | 1 | files-tree, multi-file | Cheap. |
| 35 | host `scm` | 41 / 0 / 30 | 2, 0 | used by collaboration, source-control | 1 | gitlab | Registry for one provider and one consumer. |
| 36 | ext `outline` | 37 / 0 / 0 | 1, 0 | 3 modules | 0 | visual-toc-and-code | Cheap; no unit tests. |

Glue (not ranked): `typst-editor/` 134 / 78 CSS / 1579 test (imports all 25 builtins; `exportPdf` calls
`pdfExport.export` by id), `typst-editor-element/` 169 / 151, `testing/` 193 (activates 10 builtin extensions,
used by 30 test files), `ui/popup-menu` 81 / 27 / 52 (one user: files).

## Core modules

| Module | TS / test LOC | Σcog, worst | Users (modules) | Note |
|---|---|---|---|---|
| `typst-engine` | 192 / 227 | 7, `parseReport` 3/3 | 7 | Thin TS; the cost is the wasm (22 MB), fonts (9.3 MB), Rust crate (719 lines). |
| `typst-syntax` | 184 / 157 | 67, `callPaths` 7/9 | 14 | Lezer helpers for every construct; most complex core module. |
| `project` | 157 / 143 | 54, `put` 7/9 | 19 | Deep, as intended. |
| `typst-packages` | 119 / 146 | 28, `untar` 9/9 | 1 (preview) | Own tar reader. |
| `typst-document` | 77 / 92 | 16, `minimalChange` 9/10 | 21 | |
| `paths` | 57 / 74 | 18, `resolve` 10/8 | 23 | |
| `room-protocol` | 33 / 0 | 0 | 1 (collaboration) + server | Collaboration-only; no tests. |
| `color-scheme`, `event-emitter`, `disposable`, `uploads`, `engine-assets`, `user` | 4–22 each | ≤ 6 | 1–23 | Trivial. |

## Runtime couplings between extensions (allowed only as guarded data)

- `images` → `figures`: image tools call `can().addFigureCaption` / `removeFigureCaption` (figures' Tiptap commands).
- `figures` ↔ `images`, `tables`: node group `figureBody`.
- `labels` → `figure`, `heading`, `table` node names (label prefix and target).
- `alignment` ↔ `tables`: table cells are `blockContainer` so alignment can wrap them.
- `source-control` needs collaboration's `SourceControl` (through `hosts/scm`).
- `headings` + `styles` share the text-style menu (`registerTextStyleProvider`), as designed.
- Widget → `pdf-export`: `exportPdf` = `executeCommand('pdfExport.export')`.

## Simplify-or-cut candidates

1. **GitLab rooms** (`collaboration/model/gitlab-source-control.ts`, `server/src/gitlab/` ~1k lines + fake
   GitLab, `hosts/scm`, `extensions/source-control`, gitlab e2e): the largest removable block if GitLab-backed
   rooms are not a product requirement. Plain rooms (collab) stay.
2. **comments**: drop the page-margin rewriting (`model/page-margin.ts`, drafting 0.2.2 workaround; the user sets
   margins) and the keybinding contribution point (`registerKeybinding`, one user → Tiptap / CodeMirror keymaps or
   the command's menu item). Then split `notes-gutter.ts` (359 lines, `renderCards` 10/7).
3. **Single-user contribution points** (10): `registerGutter`, `registerKeybinding`, `registerPdfExportOption`
   (comments), `registerBoxAction` (diagrams), `registerEditorFrame` (file-navigation), `registerStatusBarItem`
   (diagnostics), `registerSidePanel` (files), `registerFileDecorationProvider`, `registerSourceControl`
   (collaboration), `registerDocumentLinkProvider` (document-links). The VS Code-shaped ones stay; cut-or-fold
   candidates: `registerEditorFrame` + `file-navigation` (fold into `files`, or drop the feature) and
   `registerBoxAction` ("Edit diagram" could be the `.drawio.png` document link opening the custom editor).
4. **diagrams and spreadsheets out of the builtins**: both are optional heavy features (third-party iframe
   at runtime; 734 KB JS + 2 MB wasm + React). Ship them as extensions the host adds, like collaboration;
   the widget's default stays small and the demo adds them.
5. **figures / images / tables / labels**: move caption buttons from images' tools to figures (figures adds
   tools for any `figureBody` node), so images stops calling figures' commands; labels gets the label prefix
   from a spec flag instead of node names.
6. **`hosts/window` quick-input** (369 lines, own implementation): size to what is used (input box, pick list,
   filter); check whether `showQuickPick` features beyond that have users.
7. **`hosts/projection` tests**: the densest complexity (10 hot functions) has 90 lines of own tests; give it
   minimal-spec tests of its own (sweep A5) so constructs' tests stop being its safety net.
8. **Under-tested for their reliance**: `figures` (59 test lines), `markup` (99), `preview-sync` (18), `outline`
   (0) — e2e catches regressions late.
9. **`headings.toggleNumbering`** has no UI: cut the command, or give it a menu item.
10. **`files`**: icons for other extensions' endings (sweep A8: `icon` on `registerCustomEditorProvider`);
    `ui/popup-menu` has one user — move it into `files`.
