= Multiple files <features-multiple-files>
#set heading(outlined: false)

#import "../template.typ": screenshot

A project can hold many files: chapters, images, data, diagrams and fonts. The preview always shows the whole document, compiled from the main file.

== The file panel

#screenshot("files")

The file panel on the left shows the project as a tree, with the main file marked.

- "New" (`+`): New file, New spreadsheet, New diagram, New folder, Upload files.
- Right click a row for Rename, Delete and the rest.
- Drag files/folders onto folders to move them
- Drop files from the desktop to upload them.

To *use the files* in a Typst file, drag/drop from the files into the text:

- a spreadsheet, diagram or image becomes a figure
- another Typst file becomes an `#include`

#strong[E]very `.ttf`, `.otf`, `.ttc` or `.otc` file in the project *is a font the document can use* (`#set text(font: "Gabarito")`). Upload it like any other file.

Depending on the file type, *different editors are displayed:* 

- `.ic` opens a spreadsheet in IronCalc
- `.drawio.png` opens the draw.io editor
- text files like `.csv`, `.bib` or `.md` open in a plain text editor
- images open in a previeq

== Links between files

A book's main file includes its chapters; chapters read data, images and the bibliography from other files:

```typ
#include "chapters/method.typ"
#let runs = csv("data/runs.csv")
#bibliography("references.bib")
```

- *⌘-click a path* (or Alt+Enter) to open its file. A missing `.typ` file can be created from there.
- An included file gets "← previous file" / "next file →" links in reading order (extracted from the includes in `main.typ`).

#screenshot("multi-file-projects")
