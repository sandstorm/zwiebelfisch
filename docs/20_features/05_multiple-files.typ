= Multiple files <features-multiple-files>
#set heading(outlined: false)

#import "../template.typ": screenshot

A project can hold many files: chapters, images, data, diagrams and fonts. The preview always shows the whole document, compiled from the main file.

== The file panel

#screenshot("files")

The file panel on the left shows the project as a tree, the main file marked.

- "New" (`+`): New file, New spreadsheet, New diagram, New folder, Upload files.
- Right click a row for Rename, Delete and the rest.
- Drag rows onto folders to move them; drop files from the desktop to upload them.
- *Drag a row into the text* to use the file there: a spreadsheet, diagram or image becomes a figure, another Typst file an `#include`.
- The main file cannot be renamed, moved or deleted.

*Fonts:* as on typst.app, every `.ttf`, `.otf`, `.ttc` or `.otc` file in the project *is a font the document can use* (`#set text(font: "Gabarito")`). Upload it like any other file.

*Other files* open in their own editor: `.ic` in a spreadsheet, `.drawio.png` in the diagram editor, text files like `.csv`, `.bib` or `.md` in a plain text editor, images in a preview.

== Links between files

#screenshot("multi-file-projects")

A book's main file pulls in its chapters; chapters read data, images and the bibliography from other files:

```typ
#include "chapters/method.typ"
#let runs = csv("data/runs.csv")
#bibliography("references.bib")
```

- *⌘-click a path* (or Alt+Enter) to open its file. A missing `.typ` file can be created from there.
- An included file gets "← previous file" / "next file →" links in reading order.
- *Back and forward* work as in VS Code: ⌃- and ⌃⇧-.
- A click in the preview opens the file the clicked text is in.
