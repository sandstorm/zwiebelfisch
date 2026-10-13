= Multiple files <features-multiple-files>
#set heading(outlined: false)

#import "../template.typ": screenshot

== The file panel

#screenshot("files")

The file panel on the left shows the project as a tree: folders first, the main file marked, collaborators' initials on the files they are in. A report with its chapters, images, data and fonts:

```
main.typ
chapters/introduction.typ
chapters/method.typ
assets/test-bench.jpg
data/runs.ic
fonts/Gabarito-Regular.ttf
```

- "New" (`+`): New file, New spreadsheet, New diagram, New folder, Upload files, into the focused row's folder.
- A row's context menu (right click, Shift+F10): New file, New folder, Upload files, Rename, Delete (a folder with every file in it).
- Drag rows onto folders to move them; drop files from the desktop to upload them.
- Drag a row into the text, in the Visual or the Source editor, to use the file there (its path written from the file you drop it into):
  - a spreadsheet (`.ic`, or its `.ic.gen.typ`): a figure of its first sheet, `#figure(sheets.Budget, caption: [ ])`, and the import of its Typst file at the top (named `budget-sheets` when `sheets` is taken);
  - a Mermaid file (`.mmd`): its figure, and the import of merman;
  - a draw.io diagram (`.drawio.png`): `#figure(image("…"), caption: [ ])`, as "Insert diagram" writes it;
  - another image: `#image("…")`;
  - another Typst file: `#include "…"`, its content in place, the way a book's main file pulls in its chapters (not the file itself);
  - anything else: nothing.

  The Visual editor puts a figure after the paragraph you drop it on, the Source editor right where you drop it. One undo takes back the figure and its import. Files dropped from the desktop into the text are uploaded to the project's top folder first, then become the same.
- Keyboard: arrows, Home / End, Enter, F2 (rename), Delete, Shift+F10 (menu).
- The main file and its folder cannot be renamed, moved or deleted.
- Fonts: as on typst.app, every `.ttf`, `.otf`, `.ttc` or `.otc` file in the project, in any folder, is a font the document can use (`#set text(font: "Gabarito")`), besides Typst's default fonts. Upload it like any other file (collaborators and GitLab get it like an image); a change or a deletion applies at the next compile.
- The left rail holds the panel's button and the help's: one shows at a time, a click on the shown one's button hides the left side. Drag its separator (or use the arrow keys on it) to set its width. Below 720 px the panel lies over the editor.

How each file opens (a file with several editors gets a tab each, like Visual / Source; the one picked last is used for the next such file):

#table(
  columns: 2,
  [File], [Opens in],
  [`.typ`], [Its own Visual and Source editors.],
  [Images], [A preview; drag into the text to insert.],
  [`.csv`, `.json`, `.yaml`, `.yml`, `.toml`, `.xml`, `.bib`, `.txt`, `.md`, `.mmd`], [A plain text editor, saved as you type.],
  [`.ic`], [A spreadsheet.],
  [`.drawio.png`], [The diagram editor; its "Image" tab shows the picture.],
  [Anything else], [Name, size and type.],
)

== Links between files

#screenshot("multi-file-projects")

A book's main file pulls in its chapters; chapters read data, images and the bibliography from other files:

```typ
#include "chapters/method.typ"
#let runs = csv("data/runs.csv")
#bibliography("references.bib")
```

The preview always shows the whole document, compiled from the main file; the editors show one file at a time.

- Paths in `#import`, `#include`, `image`, `read`, `bibliography`, `json` / `csv` / `yaml` / `toml` / `xml` / `cbor` open their file: Ctrl+click or Alt+Enter (⌘-click or ⌥↩ on Mac) in the Source editor and in a raw box's code. In the Visual editor a box's picture follows its first link the same way (Alt+Enter on the selected box); hovering says where.
- Every link follows this rule: references and links to labels, web and mail addresses (bare URLs, `#link("https://…")`, opened in a new tab).
- A missing `.typ` file can be created from there.
- A file the main file includes gets "← previous file" / "next file →" links in reading order.
- Back and forward, as in VS Code: after any change of the shown file (a link, a click in the preview, the file panel, …), "← Back to _file_" above a supplementary file (a Mermaid diagram, a spreadsheet, a text file, …) returns to it, in the editor it was shown in, with its selection (Typst files). After going back, "Forward to _file_ →" returns. Typst files show the reading order instead; the keys work everywhere. Keys: Ctrl+Alt+- back, Ctrl+Shift+- forward (⌃- / ⌃⇧- on Mac). The last 50 files; renamed files keep their place, deleted ones drop out.
- A click in the preview opens the file the clicked text is in.

Long documents are easier to write, review and merge chapter by chapter; data and pictures stay in files of their own.

== How to configure

- The host gives the files and names the main file (options `files` and `main`), hears every change (`onFilesChange`) and may refuse a create, rename, delete or upload (`allowFileChange`) (@configuration-embedding-files).
- `files.panel`: `'auto'` (open while the project has more than one file), `'show'` or `'hide'` (no panel; files dropped beside the text are ignored).
