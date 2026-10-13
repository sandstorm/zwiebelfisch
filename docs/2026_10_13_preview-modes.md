# Preview modes (2026-10-13)

Temporary working note: concept for an HTML preview next to today's SVG pages. Distil into
`40_architecture/06_preview.typ` once built, then delete.

**Built (2026-10-13):** `compileHtml` and `elementsAtCursor` in the engine, `registerRenderer` in the preview host,
the extension `previewHtml`, the switch in `previewControls`; distilled into `06_preview.typ` ("Renderers") and
`20_features/14_html-preview.typ`. Differences to the design below: the pages stay built into the host (not behind
`create()`: their clicks, shading, snippets and zoom are host API); `reveal` gets the cursor's elements
(`ElementLocation[]`), not a source range; the switch is `previewControls`' (it lists every renderer); page-only
toolbar items say so with `ToolbarPlacement.renderer`. Not built: the server-side SVG preview, "Export HTML".

## Decisions (user, 2026-10-13)

- Modes: `pages` (today's SVG, default) and `html` as an **extra option**. No PDF mode.
- HTML works with Typst 0.15's **multi-page bundle** export (`document(path)` per page, `asset(path, bytes)`), as
  `mise run docs:html` builds this book.
- No page picker: the preview **follows the cursor** — the bundle page holding the element the text at the cursor
  produced (Typst keeps a span per HTML element internally; the engine maps cursor → element → page, as the SVG
  pages do), scrolled to that element. A file contributing to every page (`template.typ`) or to none (data, `#let`s
  only): keep the current page. An element without a span: the nearest ancestor with one.
- Later: server-side SVG preview (see below).

## Design

```ts
preview.registerRenderer({
  id: 'html', label: 'HTML',
  output: 'html',                       // 'pages' | 'html': what the worker produces
  create(container) { return { update(output) {…}, reveal?(path, range) {…}, dispose() {…} }; },
});
```

- Shared by every mode (the host): worker, `LatestOnly`, `FileSender`, diagnostics, view options (prelude).
- Per mode (an extension): turning the output into DOM; clicks and sync only where the mode can.
- `pages`: today's SVG pages moved behind the interface, full sync.
- `html`: engine `compileHtml(main)` → bundle `{ path → bytes }` (a document without `document(path)` →
  `index.html`). Shown in a sandboxed iframe; updated in place (DOM diff) so scrolling survives; links between
  bundle pages switch the page inside the preview; assets served from memory (blob URLs). No source sync (Typst's
  HTML carries no spans; click → source would need our own data attributes). Its export warnings are diagnostics.
- Switch "Pages / HTML" in the preview toolbar (group `2_view`), remembered in `globalState`; page-only items (page
  number, zoom) declare the mode they need.

Effort (agent): renderer interface + move SVG pages 1–2 days, `compileHtml` ~1 day, HTML mode incl. bundle links and
auto-select ~1.5 days, docs/tests ~0.5 day.

## Later: server-side SVG preview

Where the compile runs becomes a second plug-in point: worker (today) or the Go server (engine in wazero, decided
in `2026_10_13_go-server.md`). In a GitLab room the server has every edit through Yjs: it compiles once per change
and sends each client only changed pages (same page format and spans: same engine). Pays off for big documents,
weak devices, many people in one room. Cost: wazero engine build (2–4 days) + a small page protocol over the
WebSocket reusing `PageSender`'s hashes. Default: worker locally, server preview as an option for rooms.

## Open

- An "Export HTML" command (zip of the bundle) next to PDF export?
