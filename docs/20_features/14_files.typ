= Files <features-files>
#set heading(outlined: false)

== What it does

#import "../template.typ": screenshot
#screenshot("files", width: 45%)

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
- The left rail holds the panel's button and the help's (@features-help): one shows at a time, a click on the shown one's button hides the left side. Drag its separator (or use the arrow keys on it) to set its width. Below 720 px the panel lies over the editor.

How each file opens (a file with several editors gets a tab each, like Visual / Source; the one picked last is used for the next such file):

#table(
  columns: 2,
  [File], [Opens in],
  [`.typ`], [Its own Visual and Source editors.],
  [Images], [A preview; drag into the text to insert.],
  [`.csv`, `.json`, `.yaml`, `.yml`, `.toml`, `.xml`, `.bib`, `.txt`, `.md`, `.mmd`], [A plain text editor, saved as you type.],
  [`.ic`], [A spreadsheet (@features-spreadsheets).],
  [`.drawio.png`], [The diagram editor (@features-drawio-diagrams); its "Image" tab shows the picture.],
  [Anything else], [Name, size and type.],
)

How the files of a project link to each other: @features-multi-file-projects.

== How to configure

- `files.panel`: `'auto'` (open while the project has more than one file), `'show'` or `'hide'` (no panel; files dropped beside the text are ignored) (@reference-configuration-files).
- The host gives the files (`files`, `main`), hears every change (`onFilesChange`) and may refuse a create, rename, delete or upload (`allowFileChange`) (@reference-configuration-options, @reference-embedding-files).
