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
  [`typstLanguage`], [Typst highlighting and code colors in Source editors and raw boxes; the help sheet "Typst basics"], [source editor, raw-box CodeMirror, help provider],
  [`documentLinks`], [file paths in Typst text as links; command `documentLinks.createFile`], [link provider],
  [`files`], [file panel; `files.newFile` / `newFolder` / `upload` / `rename` / `delete`; read-only fallback editor `files.file` (`priority: 'fallback'`) for any other file; setting `files.panel`; search group "Files"], [side panel, menus, custom editor, search provider],
  [`help`], [the left side panel "Help" (next to Files): the help sheets of the shown file's language; rows dragged into an editor (the Visual editor reads Typst rows as Typst, a Tiptap extension), Enter inserts at the cursor (`help.insertAtCursor`), menu `help/row` with "Copy" (`help.copy`)], [side panel, commands, menu, Tiptap extension; reads `languages.getLanguageId` and `provideHelp`],
  [`fileNavigation`], ["← previous file" / "next file →" in reading order; "← Back to …" / "Forward to … →" above supplementary files, over every change of the shown file (`fileNavigation.back` / `forward`, VS Code's keys)], [editor frame, commands, key bindings],
  [`spreadsheets`], [`.ic` in IronCalc (`spreadsheets.editor`); every edit also writes `name.ic.gen.typ`; "New spreadsheet…"; "Insert spreadsheet" (a new one with a starter table, as a figure); the language `ironcalc` (`.ic`) and its help sheet "Spreadsheet formulas"], [custom editor, `file/newFile`, toolbar, `contributes.languages`, help provider],
  [`textFiles`], [csv, json, yaml, toml, xml, bib, txt, md, mmd in CodeMirror (`textFiles.editor`, with the document links for each file's language id); search group "Text" over these and the Typst files (async, in slices); their languages (`csv`, `json`, `yaml`, `toml`, `xml`, `bibtex`, `plaintext`, `markdown`, `mermaid`); the help sheet "BibTeX"], [custom editor, search provider, `contributes.languages`, help provider],
  [`diagrams`], [`.drawio.png` in diagrams.net's embedded editor (`diagrams.editor`, priority 110); "New diagram…"; "Insert diagram" (a new one as a figure); "Edit diagram" (the link on a diagram's path, priority 110: ⌘/Ctrl+click on its box's picture); setting `diagrams.editorUrl`], [custom editor, toolbar, document link provider],
  [`mermaid`], ["Insert Mermaid diagram" (a new `.mmd` with a starter flowchart, as a figure drawn by `@preview/merman`, with the import); "Edit diagram" (the link on a `.mmd` path, priority 110: ⌘/Ctrl+click on its box's picture); the help sheet "Mermaid basics" (language `mermaid`)], [toolbar, document link provider, help provider],
  [`diagnostics`], [errors underlined (Source), highlighted (Visual), counted in the status bar], [source editor, highlights, status bar],
  [`sourceControl`], ["Save to _label_…" over the registered source controls (`sourceControl.commit`); their status bar entries and resource states (file decorations)], [`editor/title`, status bar, file decorations],
  [`markup`], [strong, emphasis, links, inline code, code blocks, quotes; web and mail addresses as document links], [nodes, marks, toolbar, document link provider],
  [`headings`], [headings, their numbers, `headings.toggleNumbering`; search group "Headings"], [node, text style provider, search provider],
  [`tables`], [`#table(..)`, "Insert table", the table bar], [node, toolbar],
  [`images`], [image boxes, "Insert image", image files read-only (`images.editor`)], [node, toolbar, custom editor],
  [`figures`], [`#figure(..)` around any `figureBody` node, caption as rich text; search group "Figures" (by caption, tables and listings too)], [nodes, search provider],
  [`renderedBoxes`], [raw boxes drawn as snippets from the preview], [box renderer],
  [`outline`], [`#outline(..)` as a box, "Table of contents"], [node, toolbar],
  [`pageLayout`], [page breaks, horizontal rules], [nodes, toolbar],
  [`lists`], [bulleted, numbered and task lists], [nodes, toolbar],
  [`alignment`], [`#align(..)[..]`, `#par(justify: ..)[..]`, the Align menu], [nodes, toolbar],
  [`comments`], [margin notes in the text and a notes gutter; `comments.addComment` (Ctrl+Alt+M, ⌘⌥M on Mac); PDF option `comments.include`; search group "Comments"], [node, mark, gutter, command, PDF option, search provider],
  [`labels`], [`LabelIndex`; reference chips, label tags, the `@` list, "Add label"; search group "Labels" (not figures', not bibliography keys); references and `#link(<label>)` as links to their label], [nodes, toolbar, completion items, search provider, document link provider],
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
  [`collaboration(options)`], [The host's connection: shares the project over Yjs, draws other users' places in every editor (CodeMirror extensions, highlights, file decorations), registers a GitLab room's source control (see @architecture-server)], [CodeMirror extensions, highlights, file decorations, source control],
  [`devtools(extensions)`], [Wraps the whole list: records every extension's contributions (proxies around its context's namespaces) and shows them with the shown document and the events in a right side panel (@guide-embedding-devtools). `model/` describes values and the document as text; `recording/` wraps the contexts and describes each contribution point's arguments (by shape: a new point shows its arguments' names until it is described there); `workbench/` draws the tabs; `visual-editor/` keeps the loaded Visual editors (`registerTiptapExtension`)], [right side panel, Tiptap extension, every contribution point (recorded)],
)

== How they meet <architecture-built-in-extensions-meeting>

#table(
  columns: (auto, auto, auto),
  table.header[Contribution point][Provided by][Read by],
  [document links], [`documentLinks` (`typst`), `labels` (references), `markup` (URLs), `diagrams` and `mermaid` ("Edit diagram", priority 110)], [the Visual editor (raw boxes' code and pictures, the text), the Source editors, `textFiles`' editor, `images`],
  [file decorations], [`collaboration`, `sourceControl`], [`files`],
  [help providers], [`typstLanguage`, `mermaid`, `spreadsheets`, `textFiles`], [`help`],
  [`contributes.languages`], [`textFiles`, `spreadsheets`; the workbench (`typst`)], [`textFiles`' editor (links by language), `help`],
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
