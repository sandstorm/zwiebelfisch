= Built-in extensions <architecture-built-in-extensions>

`src/extensions/<name>/`. No host has built-in contributions. `createTypstEditor` activates the list below in this order (`builtinExtensions()` in `src/typst-editor/typst-editor.ts`). A host changes the list with `extensions: (builtinExtensions) => […]`.

== Shape of an extension <architecture-built-in-extensions-shape>

```
extensions/<name>/
  <name>.ts       entry: the factory (images()) and the controller; activate() registers everything
  <name>.css      its own styles, registered with workbench.registerStyleSheet
  model/          pure: no DOM, no editor libraries
  workbench/ visual-view/ source-view/ preview/    one folder per host it contributes to
```

- Factories without options (`markup()`, `images()`): settings and `workbench.user` configure them. Only `collaboration(options)` takes the host's connection.

== The list <architecture-built-in-extensions-list>

#table(
  columns: (auto, 2fr, 1fr),
  table.header[Extension][What it adds][Through],
  [`typstLanguage`], [Typst highlighting and code colors in Source views and raw boxes], [source view, raw-box CodeMirror],
  [`documentLinks`], [file paths in Typst text as links; command `documentLinks.createFile`], [link provider],
  [`files`], [file panel; `files.newFile` / `newFolder` / `upload` / `rename` / `delete`; read-only fallback editor `files.file` (`priority: 'fallback'`) for any other file; setting `files.panel`], [side panel, menus, custom editor],
  [`fileNavigation`], ["← previous file" / "next file →" in reading order], [editor frame],
  [`spreadsheets`], [`.ic` in IronCalc (`spreadsheets.editor`); every edit also writes `name.ic.gen.typ`; "New spreadsheet…"; "Insert spreadsheet" (a new one with a starter table, as a figure)], [custom editor, `file/newFile`, toolbar],
  [`textFiles`], [csv, json, yaml, toml, xml, bib, txt, md in CodeMirror (`textFiles.editor`)], [custom editor],
  [`diagrams`], [`.drawio.png` in diagrams.net's embedded editor (`diagrams.editor`, priority 110); "New diagram…"; "Insert diagram" (a new one as a figure); "Edit diagram"; setting `diagrams.editorUrl`], [custom editor, toolbar, box action],
  [`mermaid`], ["Insert Mermaid diagram" (a new `.mmd` with a starter flowchart, as a figure drawn by `@preview/merman`, with the import); "Edit diagram" on a box reading a `.mmd`], [toolbar, box action],
  [`diagnostics`], [errors underlined (Source), highlighted (Visual), counted in the status bar], [source view, highlights, status bar],
  [`sourceControl`], ["Save to _label_…" over the registered source controls (`sourceControl.commit`); their status bar entries and resource states (file decorations)], [`editor/title`, status bar, file decorations],
  [`markup`], [strong, emphasis, links, inline code, code blocks, quotes], [nodes, marks, toolbar],
  [`headings`], [headings, their numbers, `headings.toggleNumbering`], [node, text style provider],
  [`tables`], [`#table(..)`, "Insert table", the table bar], [node, toolbar],
  [`images`], [image boxes, "Insert image", image files read-only (`images.preview`)], [node, toolbar, custom editor],
  [`figures`], [`#figure(..)` around any `figureBody` node, caption as rich text], [nodes],
  [`renderedBoxes`], [raw boxes drawn as snippets from the preview], [box renderer],
  [`outline`], [`#outline(..)` as a box, "Table of contents"], [node, toolbar],
  [`pageLayout`], [page breaks, horizontal rules], [nodes, toolbar],
  [`lists`], [bulleted, numbered and task lists], [nodes, toolbar],
  [`alignment`], [`#align(..)[..]`, `#par(justify: ..)[..]`, the Align menu], [nodes, toolbar],
  [`comments`], [margin notes in the text and a notes gutter; `comments.addComment` (Ctrl+Alt+M, ⌘⌥M on Mac); PDF option `comments.include`], [node, mark, gutter, command, PDF option],
  [`labels`], [`LabelIndex`; reference chips, label tags, the `@` list, "Add label"], [nodes, toolbar, completion items],
  [`styles`], [`TypstStyleIndex` of the project's `/// @style` declarations; styled text; "New style…"], [node, mark, text style provider],
  [`slashCommands`], [`/` lists the Insert menu's entries and the text styles, found by label and `keywords`], [completion items (reads toolbar and text styles)],
  [`previewSync`], [preview follows the cursor; shades the selection; a click selects the source, its outline goes with the next edit or selection move; settings `previewSync.followCursor`, `previewSync.highlightSelection`], [preview toolbar, `reveal`, `setSelectionHighlight`, `onDidClickPage`, `clearClickHighlight`],
  [`previewControls`], [zoom, page number], [preview toolbar],
  [`pdfExport`], [`pdfExport.export` → Blob; "Download PDF" with the options popover; setting `pdfExport.download`], [command, preview toolbar],
)

Not built in: `collaboration(options)`. The host adds it with its connection. It shares the project over Yjs, draws other users' places in every view (CodeMirror extensions, highlights, file decorations) and registers a GitLab room's source control (see @architecture-server).

== How they meet <architecture-built-in-extensions-meeting>

#table(
  columns: (auto, auto, auto),
  table.header[Contribution point][Provided by][Read by],
  [document links], [`documentLinks`], [the views, `images`, `diagrams` and `mermaid` ("Edit diagram")],
  [file decorations], [`collaboration`, `sourceControl`], [`files`],
  [source controls], [`collaboration` (GitLab rooms)], [`sourceControl`],
  [PDF export options], [`comments`], [`pdfExport`],
  [text style menu], [`headings`, `styles`], [the Visual view toolbar, `slashCommands`],
  [Insert menu], [`images`, `diagrams`, `mermaid`, `tables`, `spreadsheets`, `outline`, `markup`, `pageLayout`, `labels`], [the Visual view toolbar, `slashCommands`],
  [node group `figureBody`], [`images`, `tables`], [`figures`],
  [menu `file/newFile`], [`files`, `spreadsheets`, `diagrams`], [`files`],
)

Schema names of other extensions are read only as data and always guarded (`schema.nodes.x`, `editor.can()`). Writing a construct: @extensions-visual-view-constructs.
