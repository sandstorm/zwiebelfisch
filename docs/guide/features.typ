= Features <guide-features>

Every feature here is a built-in extension: leave it out or replace it (@guide-embedding-extensions). Settings: @guide-embedding-settings.

== Views and preview <guide-features-views>

```
┌───────┬─ Visual | Source ─────────┬─ Preview ──────────────┐
│ Files │ the shown file           ┃ the compiled main file │
├───────┴──────────────────────────┸────────────────────────┤
│ status bar: errors and warnings                           │
└───────────────────────────────────────────────────────────┘
```

Drag the separator `┃` (or use the arrow keys on it) to give the preview 20–80 % of the width.

- *Visual view:* edits the Typst like a word processor. What it does not model shows as a raw box: its code while focused, its compiled look otherwise.
- *Source view:* the Typst text (CodeMirror): highlighting, line numbers, search.
- Both views edit the same text; cursor and undo history survive a tab switch. Untouched source stays byte for byte.
- *Preview:* updates while typing. On errors it dims and keeps the last good pages.
- Click in the preview: the editing view selects that text, opening its file if needed.
- The preview follows the cursor ("Follow cursor" in its toolbar, remembered per viewer).
- Zoom (fit width by default, 25–400 %) and "page n / total" in the preview toolbar.
- *Diagnostics:* errors and warnings underlined in both views; the status bar counts them and jumps to them.

== Writing in the Visual view <guide-features-visual>

#table(
  columns: 2,
  [Construct], [How],
  [Headings 1–3], [Text style menu, or type `# `, `## `, `### ` at a line start (as in Markdown). Numbers shown as `set heading(numbering: ..)` makes them.],
  [Bold, italic, inline code], [Ctrl+B, Ctrl+I, Ctrl+E (⌘B, ⌘I, ⌘E on Mac).],
  [Links], [Ctrl+K (⌘K on Mac), or "Link" in the selection bar.],
  [Lists], [Bulleted, numbered and task lists (`- [ ] todo`); Tab nests.],
  [Quotes, code blocks], [Ctrl+Shift+B (⌘⇧B on Mac); Insert menu. A code block's language is a field.],
  [Alignment], [Align menu or Ctrl+Shift+L / E / R / J (⌘⇧L / E / R / J on Mac): `#align(..)[..]`, `#par(justify: true)[..]`.],
  [Tables], [Insert table; a bar over the table adds and deletes rows and columns, toggles the header row.],
  [Images, figures], [Insert image (a project file, an upload, a path); drop or paste images. Figures: caption, width (or drag a corner), alt text.],
  [Table of contents], [Insert menu: `#outline()`, rendered.],
  [Page break, rule], [Ctrl+Enter (⌘↩ on Mac); Insert menu: `#pagebreak()`, `#line(length: 100%)`.],
  [Labels, references], [A label is a tag on its block; "Add label" (Insert menu) adds one. References are chips naming their target. `@` offers every label of the project. Renaming a label updates its references in every file.],
)

Undo and redo: Ctrl+Z, Ctrl+Shift+Z (⌘Z, ⌘⇧Z on Mac).

=== Custom styles <guide-features-styles>

Authors declare paragraph and text styles as Typst functions with a doc comment, in any `.typ` file (usually `styles.typ`):

```typ
/// @style paragraph Note
#let note(body) = block(fill: luma(240), inset: 8pt, radius: 4pt, body)

/// @style text Keyword
#let key(body) = text(fill: rgb("#1f4fa0"), weight: "bold", body)
```

- The text style menu offers *Note* (wraps the paragraphs in `#note[…]`) and *Keyword* (wraps the selection in `#key[…]`), and adds the import where needed.
- *Normal text* removes a paragraph style. "New style…" adds a style to `styles.typ`.
- The Visual view shows a paragraph style as a named frame, a text style as dotted underlined text, each with the class `typst-styles--<name>` for host CSS. The preview shows the real look.

== Files <guide-features-files>

The file panel shows the project as a tree. Setting `files.panel`: open with more than one file (default), always, or never.

- Folders first; the main file marked; collaborators' initials on the files they are in.
- "New" (`+`): New file, New spreadsheet, New diagram, New folder, Upload files, into the focused row's folder.
- A row's context menu (right click, Shift+F10): New file, New folder, Upload files; Rename, Delete (a folder with every file in it).
- Drag rows onto folders to move them; drop files from the desktop to upload.
- Keyboard: arrows, Home/End, Enter, F2 (rename), Delete, Shift+F10 (menu).
- The main file and its folder cannot be renamed, moved or deleted. Every change passes the host's `allowFileChange`.
- Open state, width and open folders are kept for the browser session. Below 720 px the panel lies over the editor.
- *File links:* paths in `#import`, `#include`, `image`, `read`, `bibliography`, `json` / `csv` / `yaml` / `toml` / `xml` / `cbor` open their file: Ctrl+click or Alt+Enter (⌘-click or ⌥↩ on Mac) in the Source view, "Open …" above a raw box in the Visual view. A missing `.typ` file can be created from there.
- A file the main file includes gets "previous file" / "next file" links in reading order.

How each file opens:

#table(
  columns: 2,
  [File], [Opens in],
  [`.typ`], [Its own Visual and Source views.],
  [Images], [A preview; drag into the Visual view to insert.],
  [`.csv`, `.json`, `.yaml`, `.yml`, `.toml`, `.xml`, `.bib`, `.txt`, `.md`, `.mmd`], [A plain text editor, saved 800 ms after the last keystroke.],
  [`.ic`], [A spreadsheet (@guide-features-spreadsheets).],
  [`.drawio.png`], [The diagram editor (@guide-features-diagrams).],
  [Anything else], [Name, size and type.],
)

=== Spreadsheets <guide-features-spreadsheets>

- An `.ic` file opens in #link("https://www.ironcalc.com")[IronCalc]: formulas, formats, several sheets.
- Every edit also writes `<name>.ic.gen.typ` (generated; don't edit). It defines `sheets` (each sheet as a table that looks like the spreadsheet) and `values` (the displayed cells), by sheet name.
- Not supported: merged cells, `.xlsx` files.

```typ
#import "budget.ic.gen.typ": sheets, values
#sheets.Sheet1
Rent: #values.Sheet1.at(1).at(1)
```

=== Diagrams <guide-features-diagrams>

- A `.drawio.png` is a PNG with a diagrams.net diagram inside: Typst shows it as an image, the editor opens it in diagrams.net (embedded).
- Every change is saved into the file as you draw; there is no Save button.
- An image box showing a diagram has "Edit diagram".
- Offline or self-hosted: setting `diagrams.editorUrl`.

```typ
#figure(image("diagrams/architecture.drawio.png", width: 80%), caption: [Architecture])
```

Mermaid diagrams are text, rendered by the #link("https://typst.app/universe/package/merman/")[merman] package (Mermaid in Rust, as a wasm plugin) while Typst compiles:

- A separate `.mmd` file (opens in the text editor), drawn with `mermaid(read(..))`.
- Inline code blocks with the language `mermaid`, drawn by a show rule.
- The first use downloads 3.3 MB (then cached by the browser) and adds about a second to the compile; a diagram edit takes about 0.3 s.

````typ
#import "@preview/merman:0.4.0": mermaid, show-mermaid-blocks
#figure(mermaid(read("diagrams/flow.mmd"), width: 100%), caption: [Flow])

#show raw.where(lang: "mermaid"): show-mermaid-blocks(width: 100%)
```mermaid
flowchart LR
  Source --> Typst --> PDF
```
````

== Comments <guide-features-comments>

Comments are #link("https://typst.app/universe/package/drafting/")[drafting] margin notes in the Typst source: they travel through `onFilesChange`, git, diffs and collaboration like any other text.

- Add: "Comment" (Visual view toolbar, Source view tab bar) or Ctrl+Alt+M (⌘⌥M on Mac), on a selection or at the cursor.
- A note is a thread: one list item per message, signed with `user.name` and the date.
- The Visual view shows each note as a card beside its text: reply (Ctrl+Enter sends, ⌘↩ on Mac), edit your own and unsigned messages, delete your last one, "Resolve" (deletes the note).
- The preview shows the notes in the page margin.

```typ
#import "@preview/drafting:0.2.2": margin-note, set-margin-note-defaults
#set-margin-note-defaults(…)
This is #margin-note[the selected text][- *Ada* (2026-10-10): Is this right?
- *Bob* (2026-10-11): Yes.] and a point note.#margin-note[Cite?]
```

- The first note adds the import and a `set-margin-note-defaults` call for the notes' look, unless the file has its own.
- drafting fails on a page margin given as one length; adding a note turns a top-level `#set page(margin: 1.5cm)` into `margin: (right: 4cm, rest: 1.5cm)`.

== PDF <guide-features-pdf>

- "Download PDF" in the preview toolbar opens the export options; built in: "Include comments" (off: the final version). Choices are kept for the browser session.
- The file is named after the main file (`main.pdf`).
- With errors, no PDF: a message says why.
- Without comments the document is not changed: the export compiles copies with every note removed (a range note keeps its text).
- Hosts: `exportPdf` (@guide-embedding-pdf); setting `pdfExport.download: false` removes the button.

Refusals and failures (a refused rename, no PDF, a failed save) appear as messages at the bottom right; values the editor needs (a URL, a file name) are asked in a small input box.
