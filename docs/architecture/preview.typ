= Preview <architecture-preview>

`src/hosts/preview/`. Compiles the project in a worker and shows the pages as SVG. Keeps the mechanism; extensions add the controls and decide when to use it.

#table(
  columns: (auto, 1fr),
  table.header[Host (mechanism)][Extensions (policy)],
  [engine worker, coalesced compiles, lazy page list], [toolbar items: zoom, page number (`previewControls`), "Follow cursor" (`previewSync`), "Download PDF" (`pdfExport`)],
  [hit-testing, `onDidClickPage`, `reveal`, `clearClickHighlight`], [when to reveal, where a click leads, how long its outline stays (`previewSync`)],
  [PDF export with every registered option], [the options (`comments.include`) and how they are offered (`pdfExport`)],
  [snippets of a source range], [raw boxes drawn as pictures (`renderedBoxes`)],
)

== Concepts <architecture-preview-concepts>

- *`Preview`* (`preview.ts`): the host and what `ExtensionContext.preview` is (`PreviewContributions`). `update(files, main)` is cheap per keystroke.
- *Engine worker* (`worker/`): the Typst wasm in a Web Worker. The first message is `init` (the wasm URL and the default fonts' URLs and faces, resolved on the main thread; a font file is downloaded when a compile first uses it, @architecture-core-engine-fonts). Then requests by id: `compile`, `click`, `cursor`, `boxes`, `pdf`. `FileSender` sends text every time and bytes once per `Uint8Array` identity (`null` = unchanged). `@preview` packages download on first use (`core/typst-packages`).
- *`LatestOnly`*: at most one run in flight; values pushed meanwhile replace each other. Compiles use it; reveals too, throttled to one per 80 ms. Typing never queues a backlog.
- *`PageList`* (`pages/`): a placeholder per page sized by `aspect-ratio`. An `IntersectionObserver` (one viewport above and below) decides which pages carry SVG. Only near pages whose `hash` changed get new markup.
- *Units*: the engine's `PageIndex` and `Pt`; the DOM's CSS pixels as `Px` (`pages/geometry.ts`: `measure(element)`, `pointOnPage`); the zoom is a plain factor (1 = 100 %, 96 px per 72 pt).
- *Hit-testing*: a click is converted px → pt (`pointOnPage`) and sent as `click`; the clicked source run is outlined until the next click, a successful compile or `clearClickHighlight()` and, in a project file (not a package's), fires `onDidClickPage`. `reveal(path, range)` (a `ProjectPath`, a `SourceRange`) asks `cursor` and scrolls the preview's own scroller (never `scrollIntoView`), only if the spot is off-screen.
- *Snippets*: `snippet(path, range, text)` cuts the range's boxes out of the last compiled page. No extra compile. Null when `text` is no longer what was compiled.
- *A range's boxes* (`boxes`, `boxesForRanges`): glyphs, shapes and images whose source lies in the range, plus everything drawn between the start and end tag of a locatable or tagged element whose call lies wholly in it, wherever that drawing's code lives: a `figure` of a package's picture (Mermaid via merman) or of a helper from another file. Paragraphs and lists are not taken whole (Typst gives them the span of their first child).

== Flow <architecture-preview-flow>

```
project change ─► update(files) ─► LatestOnly ─► worker: compile ─► pages + diagnostics
                                                                     │
        page list: swap pages whose hash changed ◄───────────────────┤
        onDidRender, onDidChangeDiagnostics (only if no newer update) ◄┘
click ─► px→pt ─► worker: click ─► onDidClickPage ─► previewSync selects the source
edit, selection moved away ─► previewSync ─► clearClickHighlight
cursor ─► previewSync ─► reveal ─► worker: cursor ─► scroll if off-screen
```

== Rules <architecture-preview-rules>

- A failed compile keeps the last good pages, dimmed (`typst-preview--stale`).
- Diagnostics are never stale: they fire only when no newer `update()` waits.
- `exportPdf(entry)` and `snippet` wait for running compiles, so they see the newest text. `entry.sources` replace or add text files for that export only.
- Toolbar items are placed by `group` + `order` (`navigation` first, then groups by name). Their `update()` runs at most once per frame. PDF options apply by `priority` (default 100, higher first).

Contribution points in detail: @extensions-source-view-and-preview.
