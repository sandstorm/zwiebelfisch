= Built-in extensions <architecture-built-in-extensions>

Every feature lives in `src/extensions/<name>/`; no host has built-in contributions. `createTypstEditor` activates the list below in this order (`builtinExtensions()` in `src/typst-editor/typst-editor.ts`). A host changes it with `extensions: (builtinExtensions) => […]`; `devtools` wraps the final list, last.

== Shape of an extension <architecture-built-in-extensions-shape>

```
extensions/<name>/
  <name>.ts       entry: the factory (images()) and the controller; activate() registers everything
  <name>.css      its own styles, registered with workbench.registerStyleSheet
  model/          pure: no DOM, no editor libraries
  workbench/ visual-editor/ source-editor/ preview/    one folder per host it contributes to
```

- *Factories take no options* (`markup()`, `images()`): settings and `workbench.user` configure them. Only `collaboration(options)` takes the host's connection.

== The list <architecture-built-in-extensions-list>

#table(
  columns: (auto, 2fr, 1fr),
  table.header[Extension][What it adds][Through],
  [`typstLanguage`], [Typst highlighting, the help sheet "Typst basics"; a dropped Typst file becomes `#include "…"`], [source editor, help, drop edit],
  [`imports`], [pasted Typst gets the imports it needs (the copied file's, else the known ones)], [paste edit],
  [`documentLinks`], [file paths in Typst text as links; `documentLinks.createFile`], [document links],
  [`files`], [the file panel and its commands; the read-only fallback editor; search group "Files"], [side panel, menus, custom editor, search],
  [`fileNavigation`], ["← previous file" / "next file →" in reading order; Back / Forward over shown files], [editor frame, commands, key bindings],
  [`help`], [the side panel "Help" with the shown file's help sheets; rows drag or insert into the editor], [side panel, commands, menu, Tiptap extension],
  [`spreadsheets`], [`.ic` in IronCalc, written also as `name.ic.gen.typ`; "New spreadsheet…", "Insert spreadsheet"], [custom editor, menus, toolbar, languages, help, links, drop edit],
  [`textFiles`], [csv, json, yaml, toml, xml, bib, txt, md, mmd in CodeMirror; search group "Text"], [custom editor, search, languages, help],
  [`diagrams`], [`.drawio.png` in diagrams.net; "New diagram…", "Insert diagram", "Edit diagram"], [custom editor, toolbar, links, drop edit],
  [`mermaid`], ["Insert Mermaid diagram" (a `.mmd` drawn by `@preview/merman`), "Edit diagram", "Mermaid basics"], [toolbar, links, help, known import, drop edit],
  [`diagnostics`], [errors underlined (Source), highlighted (Visual), counted in the status bar], [source editor, highlights, status bar],
  [`sourceControl`], ["Save to _label_…" and status bar entries for the registered source controls], [`editor/title`, status bar, file decorations],
  [`markup`], [strong, emphasis, underline, strike, highlight, links, inline code, code blocks, quotes], [nodes, marks, toolbar, links],
  [`math`], [the closing `$` makes a math box; Insert → "Inline math", "Display math"], [Tiptap input rule, toolbar],
  [`headings`], [headings and their numbering; search group "Headings"], [node, text styles, search],
  [`tables`], [`#table(..)`, "Insert table", the table bar], [node, toolbar],
  [`images`], [image boxes, "Insert image", pasted and dropped images, the image viewer], [node, toolbar, custom editor, drop edit],
  [`figures`], [`#figure(..)` around any `figureBody` node; search group "Figures"], [nodes, search],
  [`renderedBoxes`], [raw boxes drawn as snippets from the preview], [box renderer],
  [`outline`], [`#outline(..)` as a box, "Table of contents"], [node, toolbar],
  [`pageLayout`], [page breaks, horizontal rules], [nodes, toolbar],
  [`lists`], [bulleted, numbered and task lists], [nodes, toolbar],
  [`alignment`], [`#align(..)[..]`, `#par(justify: ..)[..]`, the Align menu], [nodes, toolbar],
  [`comments`], [margin notes with threads in cards; PDF option `comments.include`, view option `comments.show`; search group "Comments"], [node, mark, command, PDF and view option, search],
  [`labels`], [`LabelIndex`, reference chips, label tags, the `@` list; pasted labels renamed; search group "Labels"], [nodes, toolbar, completion, search, links, paste edit],
  [`styles`], [`TypstStyleIndex` of the project's `/// @style` declarations; "New style…"; search group "Styles"], [node, mark, text styles, toolbar menu, search],
  [`invisibles`], ["Invisible characters" in the View menu, for every editor], [Tiptap decorations, shared CodeMirror extension, menu, command],
  [`slashCommands`], [`/` lists the Insert menu and the text styles; the hint "Type / for commands"], [completion, Tiptap decoration],
  [`previewSync`], [the preview follows the cursor and shades the selection; a click selects the source], [preview toolbar, `reveal`, `setSelectionHighlight`, `onDidClickPage`],
  [`previewControls`], [zoom, page number; a View menu entry per view option], [preview toolbar, menu `view`, commands],
  [`previewGuides`], [view options "Page guides", "Box outlines", "Block spacing" (@architecture-built-in-extensions-guides)], [view options],
  [`pdfExport`], [`pdfExport.export` → Blob; "Download PDF" with the options popover], [command, preview toolbar],
  [`devtools`], [not in the list: wraps the final list and records every contribution; a right side panel (@configuration-embedding-devtools)], [right side panel, every contribution point],
)

=== Optional extension <architecture-built-in-extensions-optional>

Exported from the package, not in the list; a host adds it.

- *`collaboration(options)`* shares the project over #link("https://yjs.dev/")[Yjs] through the host's connection, shows other users in every editor and registers a GitLab room's source control (@architecture-server).

== How they meet <architecture-built-in-extensions-meeting>

#table(
  columns: (auto, auto, auto),
  table.header[Contribution point][Provided by][Read by],
  [document links], [`documentLinks`, `labels`, `markup`, `diagrams`, `mermaid`], [the Visual and Source editors, `textFiles`, `images`],
  [file decorations], [`collaboration`, `sourceControl`], [`files`],
  [help providers], [`typstLanguage`, `mermaid`, `spreadsheets`, `textFiles`], [`help`],
  [known imports], [`mermaid`], [`imports`],
  [paste edit providers], [`imports`, `labels`], [the Visual and Source editors],
  [`contributes.languages`], [`textFiles`, `spreadsheets`; the workbench (`typst`)], [`textFiles`, `help`],
  [source controls], [`collaboration`], [`sourceControl`],
  [PDF export options], [`comments`], [`pdfExport`],
  [view options], [`previewGuides`, `comments`], [`previewControls`],
  [menu `view`], [`invisibles`, `previewControls`], [the workbench ("View ▾")],
  [text style menu], [`headings`, `styles`], [the Visual editor toolbar, `slashCommands`],
  [Insert menu], [`images`, `diagrams`, `mermaid`, `tables`, `spreadsheets`, `outline`, `markup`, `pageLayout`, `labels`], [the Visual editor toolbar, `slashCommands`],
  [node group `figureBody`], [`images`, `tables`], [`figures`],
  [menu `file/newFile`], [`files`, `spreadsheets`, `diagrams`], [`files`],
  [search providers], [`files`, `headings`, `labels`, `figures`, `styles`, `comments`, `textFiles`; the workbench], [search everywhere],
  [`contributes.commands`], [`files`, `headings`, `comments`, `diagrams`, `spreadsheets`, `invisibles`], [the "Commands" search group],
  [shared CodeMirror extensions], [`invisibles`], [every CodeMirror],
)

- *Other extensions' schema names* are read only as data and always guarded (`schema.nodes.x`, `editor.can()`). Writing a construct: @architecture-visual-editor-constructs.

== Page guides and box outlines <architecture-built-in-extensions-guides>

`previewGuides` adds three view options (@architecture-source-editor-and-preview-view), as LaTeX's showframe. Their Typst runs before the main file, in the preview only.

- *Page guides* draw the text area, header, footer and column gutters as the page background, read from the page's settings. The code must never fail: an error would break every document's preview.
- *Box outlines* are `set block(stroke: ..)` and `set box(stroke: ..)`, so a document's own strokes win. They also shade every `v(..)` with a hatched band.
- *Block spacing* shades the gap between blocks and paragraphs. It is its own option, as it costs much more (an edit of this book: 140 ms without, 640 ms with).
- *Markers that take no space* find the spacing: placed content before and after, so the layout stays as it is. Tests check glyph positions and page counts with each option.
- *Not shown*: `h(..)` (a marker in a line would change line breaking), the spacing between list items, table rows and stack children (their layout's own, not the flow's), and the inset on its own.
- *Raw boxes* are cut from the preview's pages, so they show the guides too.
