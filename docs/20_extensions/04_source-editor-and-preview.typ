= Source editor and preview <extensions-source-editor-and-preview>

== Source editor <extensions-source-editor-and-preview-source>

`sourceEditor.registerCodeMirrorExtension(extension)` adds a CodeMirror `Extension` to every Source editor, the existing ones included. Pass the same value for all editors, or a function that makes one per editor from its `SourceEditorContext` (`document`).

```ts
import { EditorView } from '@codemirror/view';

subscriptions.push(
  sourceEditor.registerCodeMirrorExtension(EditorView.lineWrapping),
  sourceEditor.registerCodeMirrorExtension((editor) => myLint(editor.document)), // per editor
);
```

- The Source editor itself only keeps text and selection in sync with its document. The Typst language, colors, lint, links and other users' carets are all contributions.
- The code in the Visual editor's raw boxes is CodeMirror too: `visualEditor.registerRawBoxCodeMirrorExtension(editor => extension)`. The typst-language extension registers its syntax in both. Both look like CodeMirror's default in the widget's light or dark scheme (`codeColors`, from the Source editor host), as does any CodeMirror an extension makes with it.
- What fits any text, not only Typst, goes to every CodeMirror of the widget: `sourceEditor.registerSharedCodeMirrorExtension(extension)` adds it to the Source editors, the raw boxes' code and every CodeMirror that includes `sourceEditor.createSharedCodeMirrorExtension()` (the text files' editor), open or made later, until disposed. The invisibles extension registers `highlightWhitespace()` this way while invisible characters are shown. An extension making its own CodeMirror includes it next to `codeColors`:

```ts
new EditorView({ parent, doc, extensions: [basicSetup, codeColors, sourceEditor.createSharedCodeMirrorExtension()] });
```

== Document links <extensions-source-editor-and-preview-links>

`languages.registerDocumentLinkProvider(selector, provider, { priority? })` adds links to the texts `selector` matches. The Source editors, the code of raw boxes and the text files' editor show them: Ctrl+click or Alt+Enter (⌘-click or ⌥↩ on Mac) follows a link, hovering shows it ("Open …", or the link's `tooltip` for a link with a `target`, as VS Code's "Follow link"); a plain click edits. The Visual editor follows them the same way: the picture of a raw box its primary link (the first in text order that leads somewhere), the text the link under the pointer or at the cursor (a reference chip, a link mark), its tooltip as the hover.

```ts
languages.registerDocumentLinkProvider({ language: 'typst' }, {
  provideDocumentLinks(document) {   // TextDocument: path, languageId, text
    return [...document.text.matchAll(/TODO/g)].map((m) => ({
      range: SourceRange.of({ from: m.index, to: m.index + 4 }),
      tooltip: 'Open the to-do list',
      target: ProjectPath.of('/todo.typ'),
    }));
  },
});
```

- `TextDocument`: `path` (the file the text is in), `languageId`, `text` (a whole file's, or a part of one: a raw box's code). Language ids: `typst` for Typst files and raw boxes; the text files by ending: `csv`, `json`, `yaml`, `toml`, `xml`, `bibtex`, `plaintext`, `markdown`, `mermaid`. Whoever hands a text over names its language; the host knows none.
- `DocumentSelector`: a `DocumentFilter` `{ language? }` or a list of them; a filter without `language` matches every text.
- `DocumentLink`: `range` (a `SourceRange` in the text given), `target?` (a project file `ProjectPath`, or an external `URL`, `https:` or `mailto:`, opened in a new tab), `selection?` (with a file: the range in it to select, e.g. a label), `tooltip?` (what following it does: "Edit diagram", "Go to Figure · Setup in method.typ"; without a target, what the hover says), `command?` (a `Command { title, command, arguments? }` the hover offers, e.g. creating a missing file).
- The built-in providers: file paths (document-links), references and `#link(<label>)` to their label (labels), web and mail addresses (markup).
- A more specific link for the same path (diagrams' and Mermaid's "Edit diagram", spreadsheets' "Edit spreadsheet" on a `.ic.gen.typ`, over the plain file link) comes from a provider of a higher `priority`: it replaces the other where they overlap, so it is also a box's primary link.
- Keep `provideDocumentLinks` cheap; `resolveDocumentLink(link)` may fill in `target`, `tooltip` or `command` when a link is shown or followed.
- Only the providers whose selector matches a text are asked; where links of several providers overlap, the higher `priority` wins (default 100; equal: registration order).
- An extension that shows links itself (an image box's path) reads `languages.provideDocumentLinks(document)` and `languages.resolveDocumentLink(link)`.
- An extension's own CodeMirror editor shows them as the Source editors do with `languages.createDocumentLinksCodeMirrorExtension(languageId, () => path)`.

== Preview <extensions-source-editor-and-preview-preview>

The preview keeps the mechanism: the engine worker, compiles, the page list, hit-testing, scrolling. What sits on top is contributed.

#table(
  columns: 2,
  [Member], [What],
  [`registerToolbarItem(item, { group, order })`], [A toolbar control. Groups sort by name; the built-ins: `1_sync` ("Follow cursor"), `2_view` (zoom, page number), `3_export` ("Download PDF")],
  [`registerPdfExportOption(option, { priority })`], [A checkbox offered with PDF exports],
  [`pdfExportOptions()`], [The registered options, in the order an export applies them],
  [`registerViewOption(option, { priority })`], [A way to look at the pages in the preview only (a checkbox entry in the View menu)],
  [`viewOptions()`], [The registered view options, in the order the preview applies them],
  [`onDidChangeViewOptions`], [A view option was registered or disposed],
  [`setViewOptionValues(values)`], [Which view options are on, by id; the others at their default],
  [`reveal(path, range)`], [Scrolls to where a source range is drawn, if off-screen; throttled, cheap on every cursor move],
  [`onDidClickPage`], [A click on something with a source location in a project file: `{ path, from, to }`; outlined until the next click or compile],
  [`clearClickHighlight()`], [Removes the outline of the last click now],
  [`setSelectionHighlight(path, ranges, text)`], [Shades where `ranges` of `path` are drawn (selection color, no outline), once the pages show a compile of `text`; looked up again after each compile; replaces the ranges before, `[]` clears],
  [`onDidChangeDiagnostics`], [Errors and warnings of each compile of the newest files; `path` is a `ProjectPath`, `null` without location or in a package file],
  [`onDidRender`], [After every successful compile],
  [`snippet(path, range, text)`], [How a source range is drawn: its page cut down to it, as SVG; `null` when it draws nothing or `text` is outdated],
  [`exportPdf(entry)`], [A PDF of `entry.main` from the files last compiled],
)

=== Toolbar items <extensions-source-editor-and-preview-toolbar>

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

=== PDF export options <extensions-source-editor-and-preview-pdf>

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

=== View options <extensions-source-editor-and-preview-view>

A `PreviewViewOption` changes how the preview shows the document, never the documents nor their PDFs: `id` (`<extension>.<name>`), `label`, `description?`, `default`, and `apply(entry, value)`, called for every option with its value, as a PDF export option's. It returns a new `PreviewEntry` (`prelude`: lines of Typst markup run before the main file), or `entry` itself where the value changes nothing. Each option adds its own lines, so options compose.

```ts
preview.registerViewOption({
  id: 'previewGuides.boxOutlines',
  label: 'Box outlines',
  default: false,
  apply: (entry, on) => (on ? { ...entry, prelude: [...entry.prelude, '#set block(stroke: 1pt + rgb(217, 70, 239, 50%))'] } : entry),
});
```

- While the options' prelude has lines, the preview compiles a file of its own: the prelude, then `#include` of the main file. The main file is included, not copied: diagnostics, clicks, the cursor's place and snippets stay in the project's files. An error in the prelude is reported without a path; a click on what it draws (an outline) is not reported. With an empty prelude the main file is compiled as before. An option may add lines while it is off: "Comments" (`comments.show`, on by default) hides drafting's margin notes by show rules when off.
- The prelude's lines are imports, `let`, `set` and `show` rules: they must make no content (it would come before the document's first page). Set rules are defaults, so what a document sets itself wins. A page background or foreground set by the document replaces the prelude's (`previewGuides` therefore draws in the foreground when the background was replaced). Names are the option's own (`preview-guides-…`): every option's lines share the file.
- The preview applies the options by `priority` (default 100, higher first), each to what the ones before made. An `id` registered twice throws.
- Every option appears in the View menu at the top right of the editing area (menu `view`, group `preview`, checked while on): `previewControls` registers an entry per option (following `onDidChangeViewOptions`), hands this viewer's choices to `setViewOptionValues(values)` (ids of options registered later included) and remembers them in its `globalState`. Changing the values or the options compiles again.
- Raw boxes' pictures are cut from the preview's pages (`snippet`), so they show what the options draw; compiling them apart would be a second compile per edit.
