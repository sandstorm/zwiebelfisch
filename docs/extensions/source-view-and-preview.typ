= Source view and preview <extensions-source-view-and-preview>

== Source view <extensions-source-view-and-preview-source>

`sourceView.registerCodeMirrorExtension(extension)` adds a CodeMirror `Extension` to every Source view, the existing ones included. Pass the same value for all views, or a function that makes one per view from its `SourceViewContext` (`document`).

```ts
import { EditorView } from '@codemirror/view';

subscriptions.push(
  sourceView.registerCodeMirrorExtension(EditorView.lineWrapping),
  sourceView.registerCodeMirrorExtension((view) => myLint(view.document)), // per view
);
```

- The Source view itself only keeps text and selection in sync with its document. The Typst language, colors, lint, links and other users' carets are all contributions.
- The code in the Visual view's raw boxes is CodeMirror too: `visualView.registerRawBoxCodeMirrorExtension(view => extension)`. The typst-language extension registers its syntax in both.

== Document links <extensions-source-view-and-preview-links>

`languages.registerDocumentLinkProvider(provider, { priority? })` adds links to Typst text. The Source views and the code of raw boxes show them: Mod+click or Alt+Enter follows a link, hovering shows it.

```ts
languages.registerDocumentLinkProvider({
  provideDocumentLinks(document) {   // TextDocument: path, text
    return [...document.text.matchAll(/TODO/g)].map((m) => ({
      range: SourceRange.of({ from: m.index, to: m.index + 4 }),
      tooltip: 'Open the to-do list',
      target: ProjectPath.of('/todo.typ'),
    }));
  },
});
```

- `DocumentLink`: `range` (a `SourceRange` in the text given), `target?` (a project file), `tooltip?`, `command?` (a `Command { title, command, arguments? }` the hover offers, e.g. creating a missing file).
- Keep `provideDocumentLinks` cheap; `resolveDocumentLink(link)` may fill in `target`, `tooltip` or `command` when a link is shown or followed.
- Where links of several providers overlap, the higher `priority` wins (default 100; equal: registration order).
- An extension that shows links itself (an image box's path) reads `languages.provideDocumentLinks(document)` and `languages.resolveDocumentLink(link)`.

== Preview <extensions-source-view-and-preview-preview>

The preview keeps the mechanism: the engine worker, compiles, the page list, hit-testing, scrolling. What sits on top is contributed.

#table(
  columns: 2,
  [Member], [What],
  [`registerToolbarItem(item, { group, order })`], [A toolbar control. Groups sort by name; the built-ins: `1_sync` ("Follow cursor"), `2_view` (zoom, page number), `3_export` ("Download PDF")],
  [`registerPdfExportOption(option, { priority })`], [A checkbox offered with PDF exports],
  [`pdfExportOptions()`], [The registered options, in the order an export applies them],
  [`reveal(path, range)`], [Scrolls to where a source range is drawn, if off-screen; throttled, cheap on every cursor move],
  [`onDidClickPage`], [A click on something with a source location in a project file: `{ path, from, to }`],
  [`onDidChangeDiagnostics`], [Errors and warnings of each compile of the newest files; `path` is a `ProjectPath`, `null` without location or in a package file],
  [`onDidRender`], [After every successful compile],
  [`snippet(path, range, text)`], [How a source range is drawn: its page cut down to it, as SVG; `null` when it draws nothing or `text` is outdated],
  [`exportPdf(entry)`], [A PDF of `entry.main` from the files last compiled],
)

=== Toolbar items <extensions-source-view-and-preview-toolbar>

A `PreviewToolbarItem` is a function: it gets the preview (`ownerDocument`, `zoom()`, `setZoom`, `scale()`, `visiblePage()`: a `PageIndex`, counted from 0, and the page count) and returns its `elements`, an optional `update()` (at most once per frame after scrolling, resizing, zooming, new pages) and `dispose()`.

```ts
const pageNumber: PreviewToolbarItem = (preview) => {
  const element = preview.ownerDocument.createElement('span');
  return {
    elements: [element],
    update() {
      const { index, count } = preview.visiblePage();
      element.textContent = count === 0 ? '' : `${index + 1} / ${count}`;
    },
  };
};
preview.registerToolbarItem(pageNumber, { group: '2_view', order: 20 });
```

=== PDF export options <extensions-source-view-and-preview-pdf>

A `PdfExportOption` changes what is compiled, never the documents: `id` (`<extension>.<name>`), `label`, `description?`, `default`, and `apply(entry, value)`, which returns a new `PdfEntry` (`main`, `sources`: `.typ` texts replacing or adding files).

```ts
preview.registerPdfExportOption({
  id: 'comments.include',
  label: 'Include comments',
  description: 'With the margin notes as the preview shows them; without, the final version',
  default: false,
  apply: (entry, include) => (include ? entry : withoutComments(project, entry)),
});
```

- An export applies every option, also those that are off, by `priority` (default 100, higher first), each to what the ones before made.
- An `id` registered twice throws.
- The host passes values by id: `editor.exportPdf({ 'comments.include': true })`; an unknown id rejects.
