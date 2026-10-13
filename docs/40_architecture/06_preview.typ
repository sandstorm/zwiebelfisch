#import "../template.typ": mermaid

= Preview <architecture-preview>

`src/hosts/preview/` compiles the project in a worker and shows the pages as SVG. The host is the mechanism; extensions add the controls and decide when to use it.

#table(
  columns: (auto, 1fr),
  table.header[Host (mechanism)][Extensions (policy)],
  [engine worker, coalesced compiles, lazy page list], [zoom, page number (`previewControls`), "Follow cursor" (`previewSync`), "Download PDF" (`pdfExport`)],
  [hit-testing, `onDidClickPage`, `reveal`, `clearClickHighlight`, `setSelectionHighlight`], [when to reveal, what to shade, where a click leads (`previewSync`)],
  [PDF export with every registered option], [the options (`comments.include`) and how they are offered (`pdfExport`)],
  [view options: a prelude compiled before the main file, in the preview only], [the options (`previewGuides`, `comments`) and their View menu entries (`previewControls`)],
  [snippets of a source range], [raw boxes drawn as pictures (`renderedBoxes`)],
)

== Concepts <architecture-preview-concepts>

- *`Preview`* (`preview.ts`) is the host and what `ExtensionContext.preview` is (`PreviewContributions`). `update(files, main)` is cheap per keystroke.
- *Engine worker* (`worker/`): the Typst wasm in a Web Worker; `EngineWorker` is the main thread's side. Requests by id: `init`, `compile`, `click`, `cursor`, `boxes`, `pdf`. Fonts load on first use (@architecture-core-engine-fonts), `@preview` packages too (`core/typst-packages`).
- *Only changes cross the worker boundary*: `FileSender` sends bytes once per `Uint8Array`, `PageSender` a page's SVG only when its hash changed.
- *A crashed engine* (`TypstEngineCrash`, @architecture-core-engine) is restarted once and gets the newest files; if it crashes again before the next `update()`, it stays off until then, so a document that crashes Typst does not loop. Open requests are answered with the error.
- *Loading* (`progress/`): `LoadState` turns the worker's load events into one `PreviewProgress` (`engine`, `compiling`, `packages`, `fonts`, `failed`). Only the pane shows it (@architecture-workbench-loading).
- *`LatestOnly`*: at most one run in flight; newer values replace waiting ones. Compiles start at most every 150 ms, reveals every 80 ms.
- *`PageList`* (`pages/`): a placeholder per page; an `IntersectionObserver` decides which pages carry SVG.
- *Units*: the engine's `PageIndex` and `Pt`, the DOM's `Px` (`pages/geometry.ts`); the zoom is a plain factor (1 = 100 %).
- *Hit-testing*: a click is sent as `click` in pt, outlined, and fires `onDidClickPage` for a project file. `reveal(path, range)` asks `cursor` and scrolls only if the spot is off-screen; for a label it shows the labelled element.
- *Overlays* (`pages/overlays.ts`): boxes in pt, placed in percent, so they survive zoom. One layer for the click's outline, one for the selection shading.
- *Selection shading*: `setSelectionHighlight(path, ranges, text)` shades the ranges' boxes once the compiled text is `text`, and again after every compile.
- *View options*: `registerViewOption` adds a `PreviewViewOption`. While their prelude has lines, the preview compiles `/.typst-preview-view.typ`: the prelude, then `#include` of the main file, so positions stay in the project's files. Exports never see it.
- *Snippets*: `snippet(path, range, text)` cuts the range's boxes out of the last compiled page, without an extra compile.
- *A range's boxes* (`boxes`): what its source drew, plus everything inside an element whose call lies wholly in it (a `figure` of a package's picture). Never a page's header, footer or background.

== Flow <architecture-preview-flow>

#figure(
  mermaid(read("../diagrams/preview-flow.mmd"), width: 100%),
  caption: [Compile, click, cursor and selection between the editors, previewSync, the preview and its worker.],
)

== Rules <architecture-preview-rules>

- A failed compile keeps the last good pages, dimmed.
- Diagnostics are never stale: they fire only when no newer `update()` waits.
- `exportPdf(entry)` and `snippet` wait for running compiles, so they see the newest text.
- Toolbar items are placed by `group` + `order`; PDF and view options apply by `priority` (default 100, higher first).

Contribution points in detail: @architecture-source-editor-and-preview.
