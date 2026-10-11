= Help <features-help>
#set heading(outlined: false)

== What it does

#import "../template.typ": screenshot
#screenshot("help")

The question mark on the left rail opens the help, in the file panel's place: a cheat sheet for the kind of file shown, changing as you open another file. Writing a Mermaid diagram, it lists flowchart shapes and arrows; back in the chapter, it lists Typst's headings, lists and figures.

#table(
  columns: 2,
  [File], [Sheet],
  [`.typ`], [Typst basics: headings, emphasis, lists, links and references, images and figures, math, tables, code, set and show rules, imports, comments],
  [`.mmd`], [Mermaid basics: flowcharts (direction, node shapes, arrows with labels, subgraphs), sequence diagrams (participants, messages, notes)],
  [`.ic`], [Spreadsheet formulas: cell references, ranges, `SUM` / `AVERAGE` / `IF`, absolute references, other sheets; how a spreadsheet reaches the document (`sheets`, `values`, named areas: `names`, `name-values`)],
  [`.bib`], [BibTeX: `@article`, `@book`, citing with `@key`],
)

- A click selects a row and shows its whole snippet. ↑ / ↓ move, Home / End jump.
- Drag a row into the text: it lands where you drop it. In the Visual editor a Typst row becomes what it stands for (a heading, a table); inline ones (`*strong*`) go into the paragraph.
- Enter puts the selected row at the cursor of the shown Typst file, in either view. For other files it is copied: paste it, or drag it.
- A row's context menu (right click, Shift+F10): Insert at cursor, Copy.
- Each sheet links to its documentation. Files of other kinds say "No help for this file type".

== How to configure

Nothing to configure.
