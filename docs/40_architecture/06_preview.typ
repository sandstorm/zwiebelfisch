#import "../template.typ": api, mermaid, unreviewed

= Preview <architecture-preview>

#unreviewed

`Preview` in `src/hosts/preview/` compiles the project in a Web Worker (the Typst wasm, @architecture-core-engine) and shows the pages as SVG, or hands Typst's HTML export to a registered renderer. The host keeps the mechanism; extensions add the controls and decide when to use it.

#figure(
  mermaid(read("../diagrams/preview-flow.mmd"), width: 100%),
  caption: [Compile, click, cursor and selection between the editors, previewSync, the preview and its worker.],
) <architecture-preview-flow>

== Contribution points <architecture-preview-contributions>

What `ExtensionContext.preview` is.

#api("/src/hosts/preview/preview.ts", "PreviewContributions", docs: "first-sentence")
#api("/src/hosts/preview/preview.ts", "PreviewMenuContext")
#api("/src/hosts/preview/preview.ts", "PageOverlay")
#api("/src/hosts/preview/preview.ts", "PdfExportOption", docs: "first-sentence")

```ts
commands.registerCommand('previewControls.zoomIn', () => preview.setZoom(stepZoom(preview.scale, 1)));
window.registerMenuItem<PreviewMenuContext>('preview/title', {
  command: 'previewControls.zoomIn', title: 'Zoom in', shortTitle: '+', group: '3_zoom',
  when: (context) => context.previewRenderer === 'pages',
});
```

- *The toolbar is the menu `preview/title`* (`window.registerMenuItem`), its entries asked again after their commands settle, settings change and the renderer changes. Groups: `1_sync` (`previewSync`), `2_renderers` and `3_zoom` (`previewControls`), `4_export` (`pdfExport`, at the row's end).
- *Built-in users:* `previewSync` (click outline and selection shading through `createPageOverlay`), `previewProgress` (the loading note through `registerPaneOverlay`), `comments` (a PDF export option and a view option), `previewGuides` (view options), `previewHtml` (a renderer).
- *Order* of options: @architecture-extensions-rules.

== Rules <architecture-preview-rules>

- *Never behind typing* (`LatestOnly`): one run in flight, newer values replace waiting ones; compiles at most every 150 ms, reveals every 80 ms. Diagnostics fire only when no newer `update()` waits, so their offsets match the text last given; `exportPdf`, `snippet` and `boxesFor` wait for running compiles.
- *Only changes cross the worker boundary:* `FileSender` sends each `Uint8Array` once, `HashedSender` a page's SVG or an HTML file only when its hash changed; `PageList` renders SVG only for pages near the view. The wasm URL and fonts (`worker/engine-assets.ts`) are imported on the main thread only and sent with `init`, so the worker bundle copies neither.
- *A failed compile* keeps the last good pages, dimmed.
- *A crashed engine* (`TypstEngineCrash`) restarts once with the newest files; crashing again before the next `update()`, it stays off until then, so a document that crashes Typst does not loop.
- *The host only draws overlays:* boxes in pt, placed in percent, so they survive zoom; what to mark and when is the extension's. `boxesFor` answers none unless the compiled text is the `text` given.
- *A range's boxes* (`boxesFor`, `snippet`): what its source drew, plus everything inside an element whose call lies wholly in it (a `figure` of a package's picture); never a page's header, footer or background. Raw boxes' pictures are snippets, so they show what view options draw.
- *Loading is told, never shown,* by the host (`onDidLoad`, `onDidCrash`); without `previewProgress` the pane is empty while it loads: @architecture-window-loading.

== Renderers <architecture-preview-renderers>

The pages (`pages`) are built in. A registered renderer replaces them below the toolbar while it is the active one: the preview compiles only for it, and hands it the output and the cursor (after its first output, the last `reveal`).

#api("/src/hosts/preview/preview.ts", "PreviewRenderer")
#api("/src/hosts/preview/preview.ts", "PreviewRendererView")

- *Stable element ids:* the worker's `compileHtml` (Typst's bundle export, `html` and `bundle` features on, their "experimental" warnings left out) gives every element with a source span `data-typst-element` (the span's number; `.2`, `.3` for repeats), stable while other text changes.
- *Cursor → element* (`elementsAtCursor`): the innermost syntax node at the cursor that produced an element; where its output is elsewhere too (a heading's text in an outline), places inside an element of an enclosing node win. One per document, in bundle order.
- *The pages stay the host's:* their clicks, shading, zoom and snippets are API others use; with another renderer active, a snippet compiles the pages once per `update()`. Diagnostics and `onDidRender` come from the active renderer's compile.
- *`previewHtml`:* one page at a time in an `iframe sandbox="allow-same-origin"` (no scripts). A compile morphs the page in place (`morphDocument`, matched by `data-typst-element`), so it keeps its scroll position. Assets are blob URLs, one per hash; a path the bundle lacks is looked up among the project's files.

== View options <architecture-preview-view>

#api("/src/hosts/preview/preview.ts", "PreviewViewOption")
#api("/src/hosts/preview/preview.ts", "PreviewEntry")

```ts
preview.registerViewOption({
  id: 'previewGuides.boxOutlines', label: 'Box outlines', default: false,
  apply: (entry, on) => (on ? { ...entry, prelude: [...entry.prelude, '#set block(stroke: 1pt + rgb(217, 70, 239, 50%))'] } : entry),
});
```

- *The documents stay untouched:* while the prelude has lines, the preview compiles `/.zwf-preview-view.typ` (the prelude, then `#include` of the main file). Diagnostics, clicks and snippets stay in the project's files; exports never see it.
- *The document wins:* set rules are defaults. Prelude code must never fail (an error breaks every document's preview) and names carry the option's prefix (`preview-guides-…`): all options share the file.
- *`comments.show`* applies to HTML too: drafting has no page there and panics at the first note, so its prelude gives drafting zero sizes and leaves the notes out, whatever the value.
- *View menu:* `previewControls` shows every option as a checkbox (menu `view`, group `preview`), remembers the choices in its `globalState` and hands them over with `setViewOptionValues`.
- *`previewGuides`* (page guides, box outlines, block spacing): markers that take no space find the spacing, so layout stays the same (tests check glyph positions and page counts). Not shown: `h(..)` (a marker in a line would change line breaking) and spacing inside lists, tables and stacks (their layout's own). Block spacing is its own option because it costs far more (140 ms vs. 640 ms on an edit of this book).
