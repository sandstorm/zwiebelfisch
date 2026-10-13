= Source editor and preview <architecture-source-editor-and-preview>

The contribution points of the Source editor, of document links in all editors, and of the preview.

== Source editor <architecture-source-editor-and-preview-source>

`sourceEditor.registerCodeMirrorExtension(extension)` adds a #link("https://codemirror.net/")[CodeMirror] `Extension` to every Source editor, open ones included. Pass one value for all editors, or a function of the editor's `SourceEditorContext` (`document`).

```ts
import { EditorView } from '@codemirror/view';

subscriptions.push(
  sourceEditor.registerCodeMirrorExtension(EditorView.lineWrapping),
  sourceEditor.registerCodeMirrorExtension((editor) => myLint(editor.document)), // per editor
);
```
- *The Source editor itself* only keeps text and selection in sync with its document. Typst highlighting, colors, lint, links and other users' carets are contributions.
- *Raw boxes* in the Visual editor are CodeMirror too: `visualEditor.registerRawBoxCodeMirrorExtension(editor => extension)`. All of them use the widget's light or dark `codeColors`.
- *For any text*, not only Typst, use `sourceEditor.registerSharedCodeMirrorExtension(extension)`: it reaches the Source editors, raw boxes and every CodeMirror that includes `sourceEditor.createSharedCodeMirrorExtension()` (invisibles registers `highlightWhitespace()` this way). Your own CodeMirror includes it next to `codeColors`:

```ts
new EditorView({ parent, doc, extensions: [basicSetup, codeColors, sourceEditor.createSharedCodeMirrorExtension()] });
```
== Document links <architecture-source-editor-and-preview-links>

`languages.registerDocumentLinkProvider(selector, provider, { priority? })` adds links, as VS Code's "Follow link". ⌘-click or Alt+Enter follows a link, hovering shows where it leads, a plain click edits. The Source editors, raw boxes, the text files' editor and the Visual editor (reference chips, link marks, a box's picture) all show them.

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
- *`TextDocument`:* `path`, `languageId` (`typst`, or the text file's: `csv`, `json`, `bibtex`, `mermaid`, …), `text` (a whole file or a raw box's code).
- *`DocumentSelector`:* `{ language? }` or a list of them; no `language` matches every text.
- *`DocumentLink`:* `range`, `target?` (a `ProjectPath` or an `https:`/`mailto:` `URL`), `selection?` (the range to select in the target), `tooltip?`, `command?` (offered in the hover, e.g. to create a missing file).
- *Priority* (default 100): where links overlap, the higher one wins. Diagrams' "Edit diagram" (110) thus replaces the plain file link, also as a box's primary link (its first link in text order).
- *Cheap:* keep `provideDocumentLinks` fast; `resolveDocumentLink(link)` may fill in the rest when a link is shown or followed.
- *Built-in:* file paths (document-links), references and `#link(<label>)` (labels), web and mail addresses (markup).
- *Your own CodeMirror* shows them with `languages.createDocumentLinksCodeMirrorExtension(languageId, () => path)`.

== Preview <architecture-source-editor-and-preview-preview>

The preview keeps the mechanism: the engine worker, compiles, pages, hit-testing, scrolling. Everything on top is contributed.

#table(
  columns: 2,
  [Member], [What],
  [`registerToolbarItem(item, { group, order })`], [A toolbar control. Built-in groups: `1_sync` ("Follow cursor"), `2_view` (zoom, page number), `3_export` ("Download PDF")],
  [`registerPdfExportOption(option, { priority })`], [A checkbox offered with PDF exports],
  [`pdfExportOptions()`], [The registered options, in the order an export applies them],
  [`registerViewOption(option, { priority })`], [A way to look at the pages, in the preview only],
  [`viewOptions()`], [The registered view options, in the order the preview applies them],
  [`onDidChangeViewOptions`], [A view option was registered or disposed],
  [`setViewOptionValues(values)`], [Which view options are on, by id],
  [`reveal(path, range)`], [Scrolls to where a source range is drawn; cheap on every cursor move],
  [`onDidClickPage`], [A click on something from a project file: `{ path, from, to }`],
  [`clearClickHighlight()`], [Removes the outline of the last click],
  [`setSelectionHighlight(path, ranges, text)`], [Shades where `ranges` are drawn; `[]` clears],
  [`onDidChangeDiagnostics`], [Errors and warnings of each compile],
  [`onDidRender`], [After every successful compile],
  [`engineMemory`, `onDidChangeEngineMemory`], [The engine's wasm memory, for devtools],
  [`snippet(path, range, text)`], [How a source range is drawn, as SVG; `null` when it draws nothing],
  [`exportPdf(entry)`], [A PDF of `entry.main` from the files last compiled],
)

=== Toolbar items <architecture-source-editor-and-preview-toolbar>

A `PreviewToolbarItem` is a function of the preview (`ownerDocument`, `zoom()`, `setZoom`, `scale()`, `visiblePage()`). It returns its `elements`, an optional `update()` (at most once per frame) and `dispose()`.

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
=== PDF export options <architecture-source-editor-and-preview-pdf>

A `PdfExportOption` changes what is compiled, never the documents. `apply(entry, value)` returns a new `PdfEntry` (`main`, `sources`).

```ts
preview.registerPdfExportOption({
  id: 'comments.include',
  label: 'Include comments',
  description: 'With the margin notes as the preview shows them; without, the final version',
  default: false,
  apply: (entry, include) => (include ? entry : withoutComments(project, entry)),
});
```
- *Order:* an export applies every option, also those that are off, by `priority` (default 100, higher first).
- *Ids* are unique; the host passes values by id: `editor.exportPdf({ 'comments.include': true })`.

=== View options <architecture-source-editor-and-preview-view>

A `PreviewViewOption` changes how the preview shows the document, never the documents or their PDFs. `apply(entry, value)` adds lines to the `PreviewEntry`'s `prelude`, or returns `entry` unchanged.

```ts
preview.registerViewOption({
  id: 'previewGuides.boxOutlines',
  label: 'Box outlines',
  default: false,
  apply: (entry, on) => (on ? { ...entry, prelude: [...entry.prelude, '#set block(stroke: 1pt + rgb(217, 70, 239, 50%))'] } : entry),
});
```
- *Prelude:* while it has lines, the preview compiles the prelude, then `#include`s the main file. Diagnostics, clicks and snippets stay in the project's files.
- *What goes in:* only imports, `let`, `set` and `show` rules, since content would come before the first page. Prefix names with the option's (`preview-guides-…`): all options share the file.
- *Document wins:* set rules are defaults, so what a document sets itself wins.
- *Order* by `priority` (default 100, higher first). Ids are unique.
- *View menu:* `previewControls` shows every option as a checkbox entry (menu `view`, group `preview`) and remembers the choices in its `globalState`.
- *Raw boxes* are cut from the preview's pages (`snippet`), so they show what the options draw.
