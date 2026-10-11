#import "../template.typ": mermaid

= Preview <architecture-preview>

`src/hosts/preview/`. Compiles the project in a worker and shows the pages as SVG. Keeps the mechanism; extensions add the controls and decide when to use it.

#table(
  columns: (auto, 1fr),
  table.header[Host (mechanism)][Extensions (policy)],
  [engine worker, coalesced compiles, lazy page list], [toolbar items: zoom, page number (`previewControls`), "Follow cursor" (`previewSync`), "Download PDF" (`pdfExport`)],
  [hit-testing, `onDidClickPage`, `reveal`, `clearClickHighlight`, `setSelectionHighlight`], [when to reveal, what to shade, where a click leads, how long its outline stays (`previewSync`)],
  [PDF export with every registered option], [the options (`comments.include`) and how they are offered (`pdfExport`)],
  [view options: the prelude compiled before the main file, in the preview only], [the options (page guides, box outlines: `previewGuides`; comments: `comments`), which are on and their entries in the workbench's View menu (`previewControls`)],
  [snippets of a source range], [raw boxes drawn as pictures (`renderedBoxes`)],
)

== Concepts <architecture-preview-concepts>

- *`Preview`* (`preview.ts`): the host and what `ExtensionContext.preview` is (`PreviewContributions`). `update(files, main)` is cheap per keystroke.
- *Engine worker* (`worker/`): the Typst wasm in a Web Worker; `EngineWorker` is the main thread's side. The first message is `init` (the wasm URL and the default fonts' URLs and faces, resolved on the main thread; a font file is downloaded when a compile first uses it, @architecture-core-engine-fonts). Then requests by id: `compile`, `click`, `cursor`, `boxes`, `pdf`. The worker fetches the wasm itself (`downloadWasm`): streamed into `instantiateStreaming`, so it compiles while it downloads, with the bytes counted on the way. `FileSender` sends text every time and bytes once per `Uint8Array` identity (`null` = unchanged); back, `PageSender` sends a page's SVG only when the preview does not have it (by hash; `null` = the page the preview has), so a long document does not cross to the main thread per keystroke. `@preview` packages download on first use (`core/typst-packages`).
- *A crashed engine* (`TypstEngineCrash`, @architecture-core-engine): the worker answers the request with an `error` marked `crashed`; an error the worker's code did not catch (`error`) or a message that cannot be read (`messageerror`) counts the same. `EngineWorker` then terminates the worker and answers every open request with the error (nothing waits forever: a snippet is null, an export fails with the message); `start()` starts a new one with a new `FileSender` (the new engine has no files; the `PageReceiver` keeps its SVGs, the new `PageSender` sends every page). The preview restarts it at once and compiles the newest files again; the progress is `failed` meanwhile ("The Typst compiler crashed and was restarted." with the panic's message), which the workbench shows as an error message. If it crashes again before the next `update()`, the preview leaves it off ("…crashed again; it starts again with the next edit."), so a document that crashes Typst does not restart it in a loop; requests are answered with an error meanwhile. There is no timeout: no request was seen to hang, and a long compile or package download is no hang.
- *Loading* (`progress/`): unasked, the worker sends load events (`progress`: the wasm's bytes, ready or failed, the packages and the font file downloading). `LoadState` makes one `PreviewProgress` of them (`title`, `detail`, `fraction`): `engine` ("Loading the Typst compiler… 3.1 / 6.6 MB"; only the bytes when the body is compressed), then `compiling` until the first compile answers, `packages` ("Downloading \@preview/merman 0.4.0…"), `fonts`, or `failed` (the engine could not be loaded, or crashed). The pane shows it while it has no pages (`Loader`: a `status` with the title, a `progressbar` with `aria-valuenow`, laid over the empty pages, so nothing moves). Only the pane shows it, not the status bar; the constructor's `onDidChangeProgress` tells the workbench, which turns a `failed` into an error message (@architecture-workbench-loading).
- *`LatestOnly`*: at most one run in flight; values pushed meanwhile replace each other. Compiles use it, starting at most every 150 ms (each compile swaps a page's SVG and redraws the raw boxes near the view: a short document would do that per keystroke); reveals too, throttled to one per 80 ms. Typing never queues a backlog.
- *`PageList`* (`pages/`): a placeholder per page sized by `aspect-ratio`. An `IntersectionObserver` (one viewport above and below) decides which pages carry SVG. Only near pages whose `hash` changed get new markup.
- *Units*: the engine's `PageIndex` and `Pt`; the DOM's CSS pixels as `Px` (`pages/geometry.ts`: `measure(element)`, `pointOnPage`); the zoom is a plain factor (1 = 100 %, 96 px per 72 pt).
- *Hit-testing*: a click is converted px → pt (`pointOnPage`) and sent as `click`; the clicked source run is outlined until the next click, a successful compile or `clearClickHighlight()` and, in a project file (not a package's), fires `onDidClickPage`. `reveal(path, range)` (a `ProjectPath`, a `SourceRange`) asks `cursor` and scrolls the preview's own scroller (never `scrollIntoView`), only if the spot is off-screen. The engine's `jumpFromCursor` answers where the text at the offset is drawn, from the start of the element around it on (a heading, a figure, an equation): a heading's entry in the outline or a figure's in a list of figures draws the same text earlier and is skipped. Where no text is drawn (a label, a heading's `=`, a figure's call), the answer is where the element starts; for a label, the element it labels. So a followed reference (the caret at the label) shows its target.
- *Overlays* (`pages/overlays.ts`): boxes in pt, placed on their page in percent, so they survive zoom and lazy rendering. Two layers: the click's outline (`typst-preview__highlight`, fill and outline) and the selection shading (`typst-preview__selection`, a translucent fill in `--te-selection-highlight`, no outline). Both keep their colors in dark mode (outside the inverted content).
- *Selection shading*: `setSelectionHighlight(path, ranges, text)` keeps the newest ranges (`LatestOnly`); once the compiles given before ran and the compiled text of `path` is `text`, it asks `boxes` and shades them. After every successful compile it asks again (the old boxes stay until then); while other text is compiled it shades nothing. An empty list clears it at once.
- *View options*: `registerViewOption` adds a way to look at the pages (`PreviewViewOption`); `onDidChangeViewOptions` tells who lists them. Each option is applied with its value (`setViewOptionValues`, else its default); while their prelude has lines, the preview compiles `/.typst-preview-view.typ` instead of the main file: the options' prelude lines (imports, set and show rules), then `#include` of the main file. Being included, the main file keeps its positions: diagnostics, clicks, the cursor and snippets stay in the project's files, and the prelude makes no content, so the pages are the same. Diagnostics in the prelude lose their path, clicks on its drawing are not reported. With an empty prelude, the main file is compiled itself. Exports never see them.
- *Snippets*: `snippet(path, range, text)` cuts the range's boxes out of the last compiled page. No extra compile. Null when `text` is no longer what was compiled.
- *A range's boxes* (`boxes`, `boxesForRanges`): glyphs, shapes and images whose source lies in the range, plus everything drawn between the start and end tag of a locatable or tagged element whose call lies wholly in it, wherever that drawing's code lives: a `figure` of a package's picture (Mermaid via merman) or of a helper from another file. Paragraphs and lists are not taken whole (Typst gives them the span of their first child). A page's header, footer and background are never part of an element opened in its body, also not of one that breaks across the page (a raw block, a table).

== Flow <architecture-preview-flow>

#figure(
  mermaid(read("../diagrams/preview-flow.mmd"), width: 100%),
  caption: [Compile, click, cursor and selection between the editors, previewSync, the preview and its worker.],
)

== Rules <architecture-preview-rules>

- A failed compile keeps the last good pages, dimmed (`typst-preview--stale`).
- A click's own selection is outlined, not shaded too: previewSync shades a selection only when it is not the clicked range; moving on removes the outline and shades the new selection.
- Diagnostics are never stale: they fire only when no newer `update()` waits.
- `exportPdf(entry)` and `snippet` wait for running compiles, so they see the newest text. `entry.sources` replace or add text files for that export only.
- Toolbar items are placed by `group` + `order` (`navigation` first, then groups by name). Their `update()` runs at most once per frame. PDF options and view options apply by `priority` (default 100, higher first).
- Changing the view options or their values compiles the last files again.

Contribution points in detail: @architecture-source-editor-and-preview.
