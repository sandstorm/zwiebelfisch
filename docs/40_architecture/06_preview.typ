#import "../template.typ": mermaid, unreviewed

= Preview <architecture-preview>

#unreviewed

`Preview` in `src/hosts/preview/` compiles the project in a Web Worker (the Typst wasm, @architecture-core-engine) and shows the pages as SVG, or hands Typst's HTML export to a registered renderer (@architecture-preview-renderers). It is what `ExtensionContext.preview` is; the host keeps the mechanism, extensions add the controls and decide when to use it.

#figure(
  mermaid(read("../diagrams/preview-flow.mmd"), width: 100%),
  caption: [Compile, click, cursor and selection between the editors, previewSync, the preview and its worker.],
) <architecture-preview-flow>

== Contribution points <architecture-preview-contributions>

#table(
  columns: (auto, 1fr, auto),
  table.header[Member][What][Built-in users],
  [`registerToolbarItem(item, { group, order, renderer })`], [A toolbar control. Groups `1_sync`, `2_view`, `3_export`. `renderer`: shown only while that renderer is active.], [`previewSync`, `previewControls`, `pdfExport`],
  [`registerRenderer(renderer)`], [Another way to show the document; `setActiveRenderer(id)` picks one, `renderers()` lists `pages` first.], [`previewHtml` (switch: `previewControls`)],
  [`registerPdfExportOption(option, { priority })`], [A checkbox offered with PDF exports.], [`comments`],
  [`registerViewOption(option, { priority })`], [Typst run before the main file, in the preview only (pages, or also HTML).], [`previewGuides`, `comments`],
  [`createPageOverlay(className)`], [Boxes drawn over the pages as elements of the caller's class, `set(boxes)`, drawn again after every render; the boxes come from `boxesFor(path, ranges, text)` or a `PageClick`.], [`previewSync` (click outline, selection shading)],
  [`registerPaneOverlay(element)`], [An element over the whole pane below the toolbar, placed by the caller's CSS; with `onDidLoad` (engine download, ready or failed, a new engine `starting`, packages and fonts), `onDidCrash` and `isEmpty`.], [`previewProgress` (the loading note)],
)

The rest is API the host offers, see the d.ts: `update(files, main)` (cheap per keystroke), `reveal(path, range)`, `onDidClickPage` (source range and boxes; nothing marked), `boxesFor(path, ranges, text)`, `snippet(path, range, text)`, `exportPdf(entry)`, `onDidChangeDiagnostics`, `onDidRender`, `engineMemory`. Order of options: @architecture-extensions-rules.

```ts
const pageNumber: PreviewToolbarItem = (preview) => {   // ownerDocument, zoom(), setZoom, scale(), visiblePage()
  const element = preview.ownerDocument.createElement('span');
  return {
    elements: [element],
    update() {   // at most once per frame
      const { index, count } = preview.visiblePage();
      element.textContent = count === 0 ? '' : `${index + 1} / ${count}`;
    },
  };
};
preview.registerToolbarItem(pageNumber, { group: '2_view', order: 20 });

preview.registerPdfExportOption({
  id: 'comments.include', label: 'Include comments', default: false,
  apply: (entry, include) => (include ? entry : withoutComments(project, entry)),   // a new PdfEntry
});
```

== Rules <architecture-preview-rules>

- *Engine assets* (`worker/engine-assets.ts`): the wasm URL and `DEFAULT_FONTS`, imported on the main thread only (`EngineWorker` sends them with `init`), so the worker bundle does not copy the wasm and fonts.
- *Only changes cross the worker boundary:* `FileSender` sends each `Uint8Array` once, `HashedSender` a page's SVG or an HTML file's data only when its hash changed. `PageList` renders SVG only for pages near the view.
- *Never behind typing* (`LatestOnly`): one run in flight, newer values replace waiting ones; compiles at most every 150 ms, reveals every 80 ms. Diagnostics fire only when no newer `update()` waits; `exportPdf` and `snippet` wait for running compiles.
- *A failed compile* keeps the last good pages, dimmed.
- *A crashed engine* (`TypstEngineCrash`) is restarted once with the newest files; crashing again before the next `update()`, it stays off until then, so a document that crashes Typst does not loop.
- *Overlays* are in pt, placed in percent, so they survive zoom; the host only draws them, what to mark and when is the extension's. `boxesFor` waits for running compiles and answers none unless the compiled text is the `text` given.
- *A range's boxes* (`boxesFor`, `snippet`): what its source drew, plus everything inside an element whose call lies wholly in it (a `figure` of a package's picture); never a page's header, footer or background. Raw boxes' pictures are snippets, so they show what view options draw.
- *Loading* is told, never shown, by the host (`onDidLoad`, `onDidCrash`); without `previewProgress` the pane is empty while it loads: @architecture-workbench-loading.

== Renderers <architecture-preview-renderers>

The pages (`pages`) are built in. A registered renderer replaces them below the toolbar while it is the active one: the preview compiles only for it, and hands it the output and the cursor (after its first output, the last `reveal`).

```ts
preview.registerRenderer({
  id: 'html', label: 'HTML', output: 'html',          // output: what the worker compiles for it
  create(container) {                                // when it becomes the active one
    return {
      update({ files }) { … },                       // a successful compile: HtmlFile[] in bundle order
      reveal(elements) { … },                        // the cursor moved: ElementLocation[], one per page
      dispose() { … },
    };
  },
});
```

- *`compileHtml(main)`*: Typst's bundle export (`document(path)`, `asset(path, data)`; a main file without `document` is one `index.html`), with the `html` and `bundle` features on and their "experimental" warnings left out. Every element with a source span gets `data-typst-element` (the span's number, `.2`, `.3` for repeats): stable while other text changes. The worker sends a file's bytes only when its hash changed.
- *Cursor → element* (`elementsAtCursor`): the innermost syntax node at the cursor that produced an element (an element without span: its nearest ancestor with one); where that node's output is elsewhere too (a heading's text in an outline), the places inside an element of an enclosing node win. One per page, in bundle order; empty for a `#let` or a comment.
- *The pages stay the host's*: their clicks, shading, zoom and snippets are API others use. With another renderer active, a snippet compiles the pages once per `update()`. View options apply to HTML compiles only when their `outputs` include `html` (@architecture-preview-view). Diagnostics and `onDidRender` come from the active renderer's compile.
- *`previewHtml`*: one page at a time in an `iframe sandbox="allow-same-origin"` (no scripts). A compile changes the page in place (`morphDocument`, matched by `data-typst-element`), so it keeps its scroll position. Links between pages switch the page, URLs open a new tab. Assets are blob URLs, made once per hash; a path the bundle lacks is looked up among the project's files (the docs' fonts). The cursor shows the page holding its element, else the first one listed; none keeps the page.

== View options <architecture-preview-view>

A `PreviewViewOption`'s `apply(entry, value)` adds lines to the `PreviewEntry`'s `prelude`, for the compiles in its `outputs` (default `['pages']`; `entry.output` says which). While the prelude has lines, the preview compiles `/.zwf-preview-view.typ`: the prelude, then `#include` of the main file. Diagnostics, clicks and snippets stay in the project's files; exports never see it.

```ts
preview.registerViewOption({
  id: 'previewGuides.boxOutlines', label: 'Box outlines', default: false,
  apply: (entry, on) => (on ? { ...entry, prelude: [...entry.prelude, '#set block(stroke: 1pt + rgb(217, 70, 239, 50%))'] } : entry),
});
```

- *Only* imports, `let`, `set` and `show` rules: content would come before the first page. Prefix names with the option's (`preview-guides-…`): all options share the file.
- *The document wins:* set rules are defaults, so what a document sets itself wins. Prelude code must never fail: an error breaks every document's preview.
- *`comments.show`* applies to HTML too: there drafting has no page and panics at the first note, so its prelude gives drafting zero page and margin sizes and leaves the notes out, whatever the option's value.
- *View menu:* `previewControls` shows every option as a checkbox (menu `view`, group `preview`) and remembers the choices in its `globalState`; the host learns them through `setViewOptionValues`.
- *`previewGuides`* (page guides, box outlines, block spacing; see its module comment): markers that take no space find the spacing, so layout stays the same (tests check glyph positions and page counts). Not shown: `h(..)` (a marker in a line would change line breaking) and the spacing between list items, table rows and stack children (their layout's own, not the flow's). Block spacing is its own option because it costs far more (140 ms vs. 640 ms on an edit of this book).
