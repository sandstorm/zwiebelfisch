#import "../template.typ": mermaid

= Preview <architecture-preview>

`src/hosts/preview/`. Compiles the project in a worker and shows the pages as SVG. Keeps the mechanism; extensions add the controls and decide when to use it.

#table(
  columns: (auto, 1fr),
  table.header[Host (mechanism)][Extensions (policy)],
  [engine worker, coalesced compiles, lazy page list], [toolbar items: zoom, page number (`previewControls`), "Follow cursor" (`previewSync`), "Download PDF" (`pdfExport`)],
  [hit-testing, `onDidClickPage`, `reveal`, `clearClickHighlight`, `setSelectionHighlight`], [when to reveal, what to shade, where a click leads, how long its outline stays (`previewSync`)],
  [PDF export with every registered option], [the options (`comments.include`) and how they are offered (`pdfExport`)],
  [snippets of a source range], [raw boxes drawn as pictures (`renderedBoxes`)],
)

== Concepts <architecture-preview-concepts>

- *`Preview`* (`preview.ts`): the host and what `ExtensionContext.preview` is (`PreviewContributions`). `update(files, main)` is cheap per keystroke.
- *Engine worker* (`worker/`): the Typst wasm in a Web Worker. The first message is `init` (the wasm URL and the default fonts' URLs and faces, resolved on the main thread; a font file is downloaded when a compile first uses it, @architecture-core-engine-fonts). Then requests by id: `compile`, `click`, `cursor`, `boxes`, `pdf`. The worker fetches the wasm itself (`downloadWasm`): streamed into `instantiateStreaming`, so it compiles while it downloads, with the bytes counted on the way. `FileSender` sends text every time and bytes once per `Uint8Array` identity (`null` = unchanged). `@preview` packages download on first use (`core/typst-packages`).
- *Loading* (`progress/`): unasked, the worker sends load events (`progress`: the wasm's bytes, ready or failed, the packages and the font file downloading). `LoadState` makes one `PreviewProgress` of them (`title`, `detail`, `fraction`): `engine` ("Loading the Typst compiler… 3.1 / 6.6 MB"; only the bytes when the body is compressed), then `compiling` until the first compile answers, `packages` ("Downloading \@preview/merman 0.4.0…"), `fonts`, or `failed`. The pane shows it while it has no pages (`Loader`: a `status` with the title, a `progressbar` with `aria-valuenow`, laid over the empty pages, so nothing moves). Only the pane shows it, not the status bar; the constructor's `onDidChangeProgress` tells the workbench, which turns a `failed` into an error message (@architecture-workbench-loading).
- *`LatestOnly`*: at most one run in flight; values pushed meanwhile replace each other. Compiles use it; reveals too, throttled to one per 80 ms. Typing never queues a backlog.
- *`PageList`* (`pages/`): a placeholder per page sized by `aspect-ratio`. An `IntersectionObserver` (one viewport above and below) decides which pages carry SVG. Only near pages whose `hash` changed get new markup.
- *Units*: the engine's `PageIndex` and `Pt`; the DOM's CSS pixels as `Px` (`pages/geometry.ts`: `measure(element)`, `pointOnPage`); the zoom is a plain factor (1 = 100 %, 96 px per 72 pt).
- *Hit-testing*: a click is converted px → pt (`pointOnPage`) and sent as `click`; the clicked source run is outlined until the next click, a successful compile or `clearClickHighlight()` and, in a project file (not a package's), fires `onDidClickPage`. `reveal(path, range)` (a `ProjectPath`, a `SourceRange`) asks `cursor` and scrolls the preview's own scroller (never `scrollIntoView`), only if the spot is off-screen.
- *Overlays* (`pages/overlays.ts`): boxes in pt, placed on their page in percent, so they survive zoom and lazy rendering. Two layers: the click's outline (`typst-preview__highlight`, fill and outline) and the selection shading (`typst-preview__selection`, a translucent fill in `--te-selection-highlight`, no outline). Both keep their colors in dark mode (outside the inverted content).
- *Selection shading*: `setSelectionHighlight(path, ranges, text)` keeps the newest ranges (`LatestOnly`); once the compiles given before ran and the compiled text of `path` is `text`, it asks `boxes` and shades them. After every successful compile it asks again (the old boxes stay until then); while other text is compiled it shades nothing. An empty list clears it at once.
- *Snippets*: `snippet(path, range, text)` cuts the range's boxes out of the last compiled page. No extra compile. Null when `text` is no longer what was compiled.
- *A range's boxes* (`boxes`, `boxesForRanges`): glyphs, shapes and images whose source lies in the range, plus everything drawn between the start and end tag of a locatable or tagged element whose call lies wholly in it, wherever that drawing's code lives: a `figure` of a package's picture (Mermaid via merman) or of a helper from another file. Paragraphs and lists are not taken whole (Typst gives them the span of their first child). A page's header, footer and background are never part of an element opened in its body, also not of one that breaks across the page (a raw block, a table).

== Flow <architecture-preview-flow>

#figure(
  mermaid(read("../diagrams/preview-flow.mmd"), width: 100%),
  caption: [Compile, click, cursor and selection between the views, previewSync, the preview and its worker.],
)

== Rules <architecture-preview-rules>

- A failed compile keeps the last good pages, dimmed (`typst-preview--stale`).
- A click's own selection is outlined, not shaded too: previewSync shades a selection only when it is not the clicked range; moving on removes the outline and shades the new selection.
- Diagnostics are never stale: they fire only when no newer `update()` waits.
- `exportPdf(entry)` and `snippet` wait for running compiles, so they see the newest text. `entry.sources` replace or add text files for that export only.
- Toolbar items are placed by `group` + `order` (`navigation` first, then groups by name). Their `update()` runs at most once per frame. PDF options apply by `priority` (default 100, higher first).

Contribution points in detail: @extensions-source-editor-and-preview.
