#import "../template.typ": mermaid

= Preview <architecture-preview>

`Preview` in `src/hosts/preview/` compiles the project in a Web Worker (the Typst wasm, @architecture-core-engine) and shows the pages as SVG. It is what `ExtensionContext.preview` is; the host keeps the mechanism, extensions add the controls and decide when to use it.

#figure(
  mermaid(read("../diagrams/preview-flow.mmd"), width: 100%),
  caption: [Compile, click, cursor and selection between the editors, previewSync, the preview and its worker.],
) <architecture-preview-flow>

== Contribution points <architecture-preview-contributions>

#table(
  columns: (auto, 1fr, auto),
  table.header[Member][What][Built-in users],
  [`registerToolbarItem(item, { group, order })`], [A toolbar control. Groups `1_sync`, `2_view`, `3_export`.], [`previewSync`, `previewControls`, `pdfExport`],
  [`registerPdfExportOption(option, { priority })`], [A checkbox offered with PDF exports.], [`comments`],
  [`registerViewOption(option, { priority })`], [Typst run before the main file, in the preview only.], [`previewGuides`, `comments`],
)

The rest is API the host offers, see the d.ts: `update(files, main)` (cheap per keystroke), `reveal(path, range)`, `onDidClickPage`, `clearClickHighlight()`, `setSelectionHighlight(path, ranges, text)`, `snippet(path, range, text)`, `exportPdf(entry)`, `onDidChangeDiagnostics`, `onDidRender`, `engineMemory`. Order of options: @architecture-extensions-rules.

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

- *Only changes cross the worker boundary:* `FileSender` sends each `Uint8Array` once, `PageSender` a page's SVG only when its hash changed. `PageList` renders SVG only for pages near the view.
- *Never behind typing* (`LatestOnly`): one run in flight, newer values replace waiting ones; compiles at most every 150 ms, reveals every 80 ms. Diagnostics fire only when no newer `update()` waits; `exportPdf` and `snippet` wait for running compiles.
- *A failed compile* keeps the last good pages, dimmed.
- *A crashed engine* (`TypstEngineCrash`) is restarted once with the newest files; crashing again before the next `update()`, it stays off until then, so a document that crashes Typst does not loop.
- *Overlays* are in pt, placed in percent, so they survive zoom. Shading waits until the compiled text is the `text` given, and is looked up again after every compile.
- *A range's boxes* (shading, `snippet`): what its source drew, plus everything inside an element whose call lies wholly in it (a `figure` of a package's picture); never a page's header, footer or background. Raw boxes' pictures are snippets, so they show what view options draw.
- Loading state (`PreviewProgress`) is shown only by the pane: @architecture-workbench-loading.

== View options <architecture-preview-view>

A `PreviewViewOption`'s `apply(entry, value)` adds lines to the `PreviewEntry`'s `prelude`. While the prelude has lines, the preview compiles `/.typst-preview-view.typ`: the prelude, then `#include` of the main file. Diagnostics, clicks and snippets stay in the project's files; exports never see it.

```ts
preview.registerViewOption({
  id: 'previewGuides.boxOutlines', label: 'Box outlines', default: false,
  apply: (entry, on) => (on ? { ...entry, prelude: [...entry.prelude, '#set block(stroke: 1pt + rgb(217, 70, 239, 50%))'] } : entry),
});
```

- *Only* imports, `let`, `set` and `show` rules: content would come before the first page. Prefix names with the option's (`preview-guides-…`): all options share the file.
- *The document wins:* set rules are defaults, so what a document sets itself wins. Prelude code must never fail: an error breaks every document's preview.
- *View menu:* `previewControls` shows every option as a checkbox (menu `view`, group `preview`) and remembers the choices in its `globalState`; the host learns them through `setViewOptionValues`.
- *`previewGuides`* (page guides, box outlines, block spacing; see its module comment): markers that take no space find the spacing, so layout stays the same (tests check glyph positions and page counts). Not shown: `h(..)` (a marker in a line would change line breaking) and the spacing between list items, table rows and stack children (their layout's own, not the flow's). Block spacing is its own option because it costs far more (140 ms vs. 640 ms on an edit of this book).
