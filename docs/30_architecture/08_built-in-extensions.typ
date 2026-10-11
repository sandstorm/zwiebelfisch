= Built-in extensions <architecture-built-in-extensions>

`src/extensions/<name>/`. No host has built-in contributions. `createTypstEditor` activates the list below in this order (`builtinExtensions()` in `src/typst-editor/typst-editor.ts`). A host changes the list with `extensions: (builtinExtensions) => […]`.

== Shape of an extension <architecture-built-in-extensions-shape>

```
extensions/<name>/
  <name>.ts       entry: the factory (images()) and the controller; activate() registers everything
  <name>.css      its own styles, registered with workbench.registerStyleSheet
  model/          pure: no DOM, no editor libraries
  workbench/ visual-editor/ source-editor/ preview/    one folder per host it contributes to
```

- Factories without options (`markup()`, `images()`): settings and `workbench.user` configure them. Only `collaboration(options)` takes the host's connection.

== The list <architecture-built-in-extensions-list>

#table(
  columns: (auto, 2fr, 1fr),
  table.header[Extension][What it adds][Through],
  [`typstLanguage`], [Typst highlighting and code colors in Source editors and raw boxes], [source editor, raw-box CodeMirror],
  [`documentLinks`], [file paths in Typst text as links; command `documentLinks.createFile`], [link provider],
  [`files`], [file panel; `files.newFile` / `newFolder` / `upload` / `rename` / `delete`; read-only fallback editor `files.file` (`priority: 'fallback'`) for any other file; setting `files.panel`; search group "Files"], [side panel, menus, custom editor, search provider],
  [`fileNavigation`], ["← previous file" / "next file →" in reading order; "← Back to …" / "Forward to … →" above supplementary files, over every change of the shown file (`fileNavigation.back` / `forward`, VS Code's keys)], [editor frame, commands, key bindings],
  [`spreadsheets`], [`.ic` in IronCalc (`spreadsheets.editor`); every edit also writes `name.ic.gen.typ`; "New spreadsheet…"; "Insert spreadsheet" (a new one with a starter table, as a figure)], [custom editor, `file/newFile`, toolbar],
  [`textFiles`], [csv, json, yaml, toml, xml, bib, txt, md, mmd in CodeMirror (`textFiles.editor`, with the document links for each file's language id); search group "Text" over these and the Typst files (async, in slices)], [custom editor, search provider],
  [`diagrams`], [`.drawio.png` in diagrams.net's embedded editor (`diagrams.editor`, priority 110); "New diagram…"; "Insert diagram" (a new one as a figure); "Edit diagram"; setting `diagrams.editorUrl`], [custom editor, toolbar, box action],
  [`mermaid`], ["Insert Mermaid diagram" (a new `.mmd` with a starter flowchart, as a figure drawn by `@preview/merman`, with the import); "Edit diagram" on a box reading a `.mmd`], [toolbar, box action],
  [`diagnostics`], [errors underlined (Source), highlighted (Visual), counted in the status bar], [source editor, highlights, status bar],
  [`sourceControl`], ["Save to _label_…" over the registered source controls (`sourceControl.commit`); their status bar entries and resource states (file decorations)], [`editor/title`, status bar, file decorations],
  [`markup`], [strong, emphasis, links, inline code, code blocks, quotes], [nodes, marks, toolbar],
  [`headings`], [headings, their numbers, `headings.toggleNumbering`; search group "Headings"], [node, text style provider, search provider],
  [`tables`], [`#table(..)`, "Insert table", the table bar], [node, toolbar],
  [`images`], [image boxes, "Insert image", image files read-only (`images.preview`)], [node, toolbar, custom editor],
  [`figures`], [`#figure(..)` around any `figureBody` node, caption as rich text; search group "Figures" (by caption, tables and listings too)], [nodes, search provider],
  [`renderedBoxes`], [raw boxes drawn as snippets from the preview], [box renderer],
  [`outline`], [`#outline(..)` as a box, "Table of contents"], [node, toolbar],
  [`pageLayout`], [page breaks, horizontal rules], [nodes, toolbar],
  [`lists`], [bulleted, numbered and task lists], [nodes, toolbar],
  [`alignment`], [`#align(..)[..]`, `#par(justify: ..)[..]`, the Align menu], [nodes, toolbar],
  [`comments`], [margin notes in the text and a notes gutter; `comments.addComment` (Ctrl+Alt+M, ⌘⌥M on Mac); PDF option `comments.include`; search group "Comments"], [node, mark, gutter, command, PDF option, search provider],
  [`labels`], [`LabelIndex`; reference chips, label tags, the `@` list, "Add label"; search group "Labels" (not figures', not bibliography keys)], [nodes, toolbar, completion items, search provider],
  [`styles`], [`TypstStyleIndex` of the project's `/// @style` declarations; styled text; "New style…"; search group "Styles" (applies to the selection in either editor; the Visual editors followed by a Tiptap extension)], [node, mark, text style provider, Tiptap extension, search provider],
  [`slashCommands`], [`/` lists the Insert menu's entries and the text styles, found by label and `keywords`; the hint "Type / for commands" in the empty paragraph holding the cursor (not in table cells)], [completion items (reads toolbar and text styles), Tiptap extension (a decoration)],
  [`previewSync`], [preview follows the cursor; shades the selection; a click selects the source, its outline goes with the next edit or selection move; settings `previewSync.followCursor`, `previewSync.highlightSelection`], [preview toolbar, `reveal`, `setSelectionHighlight`, `onDidClickPage`, `clearClickHighlight`],
  [`previewControls`], [zoom, page number], [preview toolbar],
  [`pdfExport`], [`pdfExport.export` → Blob; "Download PDF" with the options popover; setting `pdfExport.download`], [command, preview toolbar],
)

=== Optional extensions <architecture-built-in-extensions-optional>

Exported from the package, not in the list; a host adds them.

#table(
  columns: (auto, 2fr, 1fr),
  table.header[Extension][What it adds][Through],
  [`collaboration(options)`], [The host's connection: shares the project over Yjs, draws other users' places in every view (CodeMirror extensions, highlights, file decorations), registers a GitLab room's source control (see @architecture-server)], [CodeMirror extensions, highlights, file decorations, source control],
  [`devtools(extensions)`], [Wraps the whole list: records every extension's contributions (proxies around its context's namespaces) and shows them with the shown document and the events in a right side panel (@guide-embedding-devtools). `model/` describes values and the document as text; `recording/` wraps the contexts and describes each contribution point's arguments (by shape: a new point shows its arguments' names until it is described there); `workbench/` draws a view per tab; `visual-editor/` keeps each Visual editor's editor (`registerTiptapExtension`)], [right side panel, Tiptap extension, every contribution point (recorded)],
)

== How they meet <architecture-built-in-extensions-meeting>

#table(
  columns: (auto, auto, auto),
  table.header[Contribution point][Provided by][Read by],
  [document links], [`documentLinks` (`typst`)], [the views, `textFiles`' editor, `images`, `diagrams` and `mermaid` ("Edit diagram")],
  [file decorations], [`collaboration`, `sourceControl`], [`files`],
  [source controls], [`collaboration` (GitLab rooms)], [`sourceControl`],
  [PDF export options], [`comments`], [`pdfExport`],
  [text style menu], [`headings`, `styles`], [the Visual editor toolbar, `slashCommands`],
  [Insert menu], [`images`, `diagrams`, `mermaid`, `tables`, `spreadsheets`, `outline`, `markup`, `pageLayout`, `labels`], [the Visual editor toolbar, `slashCommands`],
  [node group `figureBody`], [`images`, `tables`], [`figures`],
  [menu `file/newFile`], [`files`, `spreadsheets`, `diagrams`], [`files`],
  [search providers], [`files`, `headings`, `labels`, `figures`, `styles`, `comments`, `textFiles`; the workbench (commands, settings)], [search everywhere (the window)],
  [`contributes.commands`], [`files`, `headings`, `comments`, `diagrams`, `spreadsheets`], [the workbench's "Commands" group],
)

Schema names of other extensions are read only as data and always guarded (`schema.nodes.x`, `editor.can()`). Writing a construct: @extensions-visual-editor-constructs.
