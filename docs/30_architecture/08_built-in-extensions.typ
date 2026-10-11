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
  [`typstLanguage`], [Typst highlighting in Source editors and raw boxes (colored by the Source editor host's `codeColors`); the help sheet "Typst basics"], [source editor, raw-box CodeMirror, help provider],
  [`imports`], [Typst pasted into a file gets the imports it needs, in the paste's undo step: the copied file's (a copy from either editor puts them on the clipboard as `application/x-typst-imports`, paths written from the target file), else the known imports], [Tiptap extension (an appended transaction), source editor (a transaction filter); reads `languages.provideKnownImports`],
  [`documentLinks`], [file paths in Typst text as links; command `documentLinks.createFile`], [link provider],
  [`files`], [file panel; `files.newFile` / `newFolder` / `upload` / `rename` / `delete`; read-only fallback editor `files.file` (`priority: 'fallback'`) for any other file; setting `files.panel`; search group "Files"], [side panel, menus, custom editor, search provider],
  [`help`], [the left side panel "Help" (next to Files): the help sheets of the shown file's language; rows dragged into an editor (the Visual editor reads Typst rows as Typst, a Tiptap extension), Enter inserts at the cursor (`help.insertAtCursor`), menu `help/row` with "Copy" (`help.copy`)], [side panel, commands, menu, Tiptap extension; reads `languages.getLanguageId` and `provideHelp`],
  [`fileNavigation`], ["← previous file" / "next file →" in reading order; "← Back to …" / "Forward to … →" above supplementary files, over every change of the shown file (`fileNavigation.back` / `forward`, VS Code's keys)], [editor frame, commands, key bindings],
  [`spreadsheets`], [`.ic` in IronCalc (`spreadsheets.editor`); every edit also writes `name.ic.gen.typ`; "New spreadsheet…"; "Insert spreadsheet" (a new one with a starter table, as a figure); the language `ironcalc` (`.ic`) and its help sheet "Spreadsheet formulas"], [custom editor, `file/newFile`, toolbar, `contributes.languages`, help provider],
  [`textFiles`], [csv, json, yaml, toml, xml, bib, txt, md, mmd in CodeMirror (`textFiles.editor`, the Source editor's look `codeColors` and its shared extensions, with the document links for each file's language id); search group "Text" over these and the Typst files (async, in slices); their languages (`csv`, `json`, `yaml`, `toml`, `xml`, `bibtex`, `plaintext`, `markdown`, `mermaid`); the help sheet "BibTeX"], [custom editor, search provider, `contributes.languages`, help provider],
  [`diagrams`], [`.drawio.png` in diagrams.net's embedded editor (`diagrams.editor`, priority 110); "New diagram…"; "Insert diagram" (a new one as a figure); "Edit diagram" (the link on a diagram's path, priority 110: ⌘/Ctrl+click on its box's picture); setting `diagrams.editorUrl`], [custom editor, toolbar, document link provider],
  [`mermaid`], ["Insert Mermaid diagram" (a new `.mmd` with a starter flowchart, as a figure drawn by `@preview/merman`, with the import); "Edit diagram" (the link on a `.mmd` path, priority 110: ⌘/Ctrl+click on its box's picture); the help sheet "Mermaid basics" (language `mermaid`); `mermaid` comes from merman (a known import)], [toolbar, document link provider, help provider, known import],
  [`diagnostics`], [errors underlined (Source), highlighted (Visual), counted in the status bar], [source editor, highlights, status bar],
  [`sourceControl`], ["Save to _label_…" over the registered source controls (`sourceControl.commit`); their status bar entries and resource states (file decorations)], [`editor/title`, status bar, file decorations],
  [`markup`], [strong, emphasis, underline, strike, highlight, links, inline code, code blocks, quotes; web and mail addresses as document links], [nodes, marks, toolbar, document link provider],
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
  [`invisibles`], [invisible characters on demand ("Show invisibles"): in the Visual editor `·` spaces, `°` non-breaking spaces, `→` tabs, `↵` line breaks, `¶` paragraph ends (decorations drawn by CSS; once when turned on, then only the paragraphs an edit touches); in every CodeMirror `highlightWhitespace()`; `invisibles.toggle`, setting `invisibles.show`, else the viewer's last choice (`globalState`)], [Tiptap extension (decorations), shared CodeMirror extension, `editor/title`, command],
  [`slashCommands`], [`/` lists the Insert menu's entries and the text styles, found by label and `keywords`; the hint "Type / for commands" in the empty paragraph holding the cursor (not in table cells)], [completion items (reads toolbar and text styles), Tiptap extension (a decoration)],
  [`spellcheck`], [the browser's spell checking in the Visual editor: `spellcheck` on its editable element (setting `spellcheck.enabled`), `lang` from the first `set text(lang: .., region: ..)` of the shown file, else the main file, read again 300 ms after edits. Code sets `spellcheck="false"` where it is made (the raw boxes' CodeMirror, `markup`'s inline code and code blocks)], [Tiptap extension (ProseMirror's `attributes` prop, merged with the host's)],
  [`previewSync`], [preview follows the cursor; shades the selection; a click selects the source, its outline goes with the next edit or selection move; settings `previewSync.followCursor`, `previewSync.highlightSelection`], [preview toolbar, `reveal`, `setSelectionHighlight`, `onDidClickPage`, `clearClickHighlight`],
  [`previewControls`], [zoom, page number; the View menu: a checkbox per view option, this viewer's choices kept in `globalState`], [preview toolbar, `setViewOptionValues`],
  [`previewGuides`], [view options "Page guides" (`@preview/scaffolder`) and "Box outlines" (set rules for `block` and `box`), off by default (@architecture-built-in-extensions-guides)], [view options],
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
  [known imports], [`mermaid`], [`imports`],
  [`contributes.languages`], [`textFiles`, `spreadsheets`; the workbench (`typst`)], [`textFiles`' editor (links by language), `help`],
  [source controls], [`collaboration` (GitLab rooms)], [`sourceControl`],
  [PDF export options], [`comments`], [`pdfExport`],
  [view options], [`previewGuides`], [`previewControls` (the View menu)],
  [text style menu], [`headings`, `styles`], [the Visual editor toolbar, `slashCommands`],
  [Insert menu], [`images`, `diagrams`, `mermaid`, `tables`, `spreadsheets`, `outline`, `markup`, `pageLayout`, `labels`], [the Visual editor toolbar, `slashCommands`],
  [node group `figureBody`], [`images`, `tables`], [`figures`],
  [menu `file/newFile`], [`files`, `spreadsheets`, `diagrams`], [`files`],
  [search providers], [`files`, `headings`, `labels`, `figures`, `styles`, `comments`, `textFiles`; the workbench (commands, settings)], [search everywhere (the window)],
  [`contributes.commands`], [`files`, `headings`, `comments`, `diagrams`, `spreadsheets`, `invisibles`], [the workbench's "Commands" group],
  [shared CodeMirror extensions], [`invisibles`], [the Source editors, raw boxes (the workbench), `textFiles`' editor],
)

Schema names of other extensions are read only as data and always guarded (`schema.nodes.x`, `editor.can()`). Writing a construct: @extensions-visual-editor-constructs.

== Page guides and box outlines <architecture-built-in-extensions-guides>

`previewGuides` adds two view options (@extensions-source-editor-and-preview-view). Their Typst, run before the main file in the preview only:

- *Page guides*: `scaffolding()` of `@preview/scaffolder:0.2.1` (the text area, header, footer and column gutters, read from the page's own settings) as the page background. A document that sets a background replaces it; the foreground then draws the guides (`context if page.background != guides { guides }`), over the text. A document that sets both has no guides.
- *Box outlines*: `set block(stroke: …)` and `set box(stroke: …)`. Set rules are defaults: a document's own set rules and arguments win. Typst folds a stroke argument with the stroke set before it, so a document's `stroke: red` would take a set rule's thickness and dash: the outline has no dash and Typst's own thickness (1pt), and only its translucent paint shows where a document's stroke names no paint (`stroke: 2pt`), or on the sides a document leaves out (`stroke: (left: red)`).
- *Inset and spacing on their own*: Typst 0.15 lets a `show block` rule read `inset`, `outset`, `above` and `below` (all fields are filled in). Drawing them means returning a new block from the rule, which the rule matches again ("maximum show rule depth exceeded") unless marked by a label, and a label would replace the document's own (its references break); blocks Typst makes for lists or headings cannot be rebuilt from their fields at all. `above` and `below` collapse with the neighbours' (the gap is the larger), so a block's own spacing is not what is laid out. So the outline is the box Typst draws a stroke on: around the inset, widened by the outset.
- *Colors*: a blue (`#3b82f6`) and a translucent magenta (`#d946ef`, 50 %), mid-tones that read on the inverted pages of the dark mode, too.
- *Raw boxes*: their pictures are cut from the preview's pages, so they show guides and outlines. Compiling the pictures without the options would need a second compile per edit; the pictures show what the preview shows instead.
