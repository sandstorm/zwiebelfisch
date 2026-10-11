= Features <guide-features>

The examples are from a report measuring compile times, as in the demo's advanced example (`?example=advanced`). Settings: @guide-configuration.

== Views and preview <guide-features-views>

```
┌───────┬─ Visual | Source ─────────┬─ Preview ──────────────┐
│ Files │ the shown file           ┃ the compiled main file │
├───────┴──────────────────────────┸────────────────────────┤
│ status bar: errors and warnings                           │
└───────────────────────────────────────────────────────────┘
```

- *Visual view:* edits the Typst like a word processor. What it does not model (math, function calls) shows as a raw box: its code while focused, its compiled look otherwise.
- *Source view:* the Typst text: highlighting, line numbers, search.
- Both views edit the same text; cursor and undo history survive a tab switch. Untouched source stays byte for byte.
- *Preview:* updates while typing. On errors it dims and keeps the last good pages.
- Click in the preview: the editing view selects that text, opening its file if needed.
- "Follow cursor" (preview toolbar): the preview scrolls to the text being edited.
- Zoom (fit width by default, 25–400 %) and "page n / total" in the preview toolbar.
- Drag the separator `┃` (or use the arrow keys on it): the preview gets 20–80 % of the width.
- *Errors and warnings:* underlined in both views, the message as tooltip. The status bar counts them and jumps to them.

== Writing <guide-features-visual>

```typ
We compiled every document *twice*: from scratch and after a _one-word_ edit,
with the #link("https://typst.app")[Typst] compiler (`typst compile`).

+ Generate documents of 1 to 100 pages.
+ Compile each one cold, then incrementally.

- [x] Run the measurements
- [ ] Ask Grace to check the numbers
```

#table(
  columns: 2,
  [Construct], [How],
  [Bold, italic, inline code], [Ctrl+B, Ctrl+I, Ctrl+E (⌘B, ⌘I, ⌘E on Mac), or the bar over a selection.],
  [Link], [Ctrl+K (⌘K on Mac), or "Link" in the bar over a selection.],
  [Lists], [List buttons: bulleted, numbered, task list (`- [ ] todo`). Tab nests.],
  [Quote], [Ctrl+Shift+B (⌘⇧B on Mac), or Insert → Quote.],
  [Code block], [Insert → Code block. Its language is a field.],
  [Alignment], [Align menu, or Ctrl+Shift+L / E / R / J (⌘⇧L / E / R / J on Mac): `#align(center)[..]`, `#par(justify: true)[..]`.],
  [Undo, redo], [Ctrl+Z, Ctrl+Shift+Z (⌘Z, ⌘⇧Z on Mac).],
  [Anything from the Insert or text style menu], [Type `/` at a line start or after a space, then part of its name: `/table`, `/h2`, `/quote`. Other words find entries, too (`/spreadsheet` → Insert table). ↑ / ↓ choose, Enter or Tab inserts (the `/…` goes), Escape closes.],
)

== Custom styles <guide-features-styles>

A block or inline style is a Typst function with a `/// @style` doc comment, in any `.typ` file of the project (usually `styles.typ`):

```typ
/// @style block Note
#let note(body) = block(inset: 8pt, stroke: (left: 2.5pt + blue), body)

/// @style inline Term
#let term(body) = text(fill: blue, style: "italic", body)
```

```typ
#import "styles.typ": note, term

Typst compiles #term[incrementally]: it redoes only what an edit touches.

#note[The numbers in this report are illustrative.]
```

- *block* wraps whole blocks (paragraphs, lists, headings), shown as a named frame: *Note* wraps the selected paragraphs in `#note[…]`.
- *inline* wraps a run of text inside a paragraph, shown underlined: *Term* wraps the selection in `#term[…]`.
- The text style menu offers both and adds the import where needed.
- *Normal text* removes a block style. "New style…" adds a block style to `styles.typ`.
- The preview shows the real look.

== Headings and table of contents <guide-features-headings>

```typ
#set heading(numbering: "1.1")
#outline(depth: 2)

= Introduction <intro>
== Goals
```

- Text style menu: Heading 1–3. Or type `# `, `## `, `### ` at a line start.
- Numbers appear in the Visual view as `#set heading(numbering: ..)` makes Typst number them.
- Insert → Table of contents: `#outline()`, shown compiled.

== Images and figures <guide-features-images>

```typ
#figure(
  image("assets/test-bench.jpg", width: 60%, alt: "Laptop running the benchmark"),
  caption: [The measurement setup.],
) <fig:setup>

All runs used the machine in @fig:setup.
```

- Insert → Insert image: pick one of the project's images, "Upload image…" or "Enter a path…".
- Drop or paste image files into the text: they are uploaded to the project's top folder and inserted (a second `image.png` becomes `image-2.png`).
- Drag an image from the file panel into the text to insert it there.
- PNG, JPEG, GIF, SVG and WebP.
- A selected image has a toolbar: "Add caption" / "Remove caption" (wraps it in `#figure`), width 25 / 50 / 75 / 100 %, "Alt text", "Edit code". Drag a corner or side to set any width.
- The caption is text like any other: bold, references, comments.
- A label on the figure (@guide-features-labels) lets the text refer to it.

== Tables <guide-features-tables>

```typ
#figure(
  table(
    columns: 3,
    table.header([*Pages*], [*Cold*], [*Incremental*]),
    [1], [18 ms], [4 ms],
    [100], [820 ms], [12 ms],
  ),
  caption: [Median compile times.],
) <tab:timings>
```

- Insert → Insert table: a 2 × 2 `#table`.
- The bar over a table: Add row, Add column, Delete row, Delete column, Header row.
- A table the Visual view cannot edit as one (e.g. `columns` not a number) stays a raw box.
- Tables computed in a spreadsheet: @guide-features-spreadsheets.

== Labels and cross-references <guide-features-labels>

```typ
= Results <results>
@tab:timings lists the medians; @fig:setup shows the setup.
```

- A label shows as a tag on its block (a heading, a figure, a table).
- Insert → Add label: type the name into a new tag (`fig:`, `tab:` or `sec:` to start with).
- Click a tag: "Rename…" (updates the references in every file), "Rename without updating references…", "Remove label".
- A reference shows as a chip naming its target ("Figure · The measurement setup."); a reference to a missing label is marked.
- Type `@` for a list of the project's labels, found by name or by what they label. Enter, Tab or a click inserts the reference; so does a space or punctuation right after a whole name (`@intro.`).

== Page layout <guide-features-page-layout>

```typ
#outline()
#pagebreak()
= Introduction
…
#line(length: 100%)
```

- Page break: Ctrl+Enter (⌘↩ on Mac), or Insert → Insert page break.
- Horizontal rule: Insert → Horizontal rule.
- Page size and margins are Typst code (`#set page(..)`): a raw box in the Visual view, or the Source view.

== Spreadsheets <guide-features-spreadsheets>

The measured runs live in `data/runs.ic`; the report shows the sheet as a table and quotes one value:

```typ
#import "data/runs.ic.gen.typ": sheets, values

#figure(sheets.Runs, caption: [Cold compile times (ms), three runs each.]) <tab:runs>

The 100-page document took #values.Runs.at(4).at(4) ms (median, @tab:runs).
```

- File panel → New → "New spreadsheet…" creates an `.ic` file and opens it in #link("https://www.ironcalc.com")[IronCalc]: formulas, formats, several sheets.
- Insert → Insert spreadsheet (or `/spreadsheet`): names a new `.ic` (proposed: `data/table.ic` next to the file), fills in a starter table, inserts `#figure(sheets.Sheet1, caption: [ ])` with its import and opens the spreadsheet. If `sheets` already names another spreadsheet's tables, the new one is imported as `table-sheets`.
- Every edit also writes `<name>.ic.gen.typ` (generated; don't edit). It holds, by sheet name:
  - `sheets`: each sheet as a `table` that looks like the spreadsheet (column widths, fills, fonts, borders).
  - `values`: the displayed cells as strings, row by row: `values.Runs.at(1).at(0)` is A2.
- The preview follows every edit of the spreadsheet.
- Not supported: merged cells, `.xlsx` files.

== draw.io diagrams <guide-features-diagrams>

```typ
#figure(
  image("diagrams/architecture.drawio.png", width: 80%),
  caption: [The editor, the compile worker and the preview.],
) <fig:architecture>
```

- A `.drawio.png` is a PNG with a diagrams.net diagram inside: Typst shows it as an image, the editor opens it in diagrams.net.
- File panel → New → "New diagram…" creates one and opens it.
- Insert → Insert diagram (or `/diagram`): creates one (proposed: `diagrams/diagram.drawio.png` next to the file), inserts `#figure(image("…"), caption: [ ])` and opens it.
- A selected image showing a diagram has "Edit diagram".
- Every change is saved into the file as you draw; there is no Save button.

== Mermaid diagrams <guide-features-mermaid>

Mermaid diagrams are text, drawn by the #link("https://typst.app/universe/package/merman/")[merman] package while Typst compiles.

From a file (`diagrams/measurement.mmd`, opens in the text editor):

```typ
#import "@preview/merman:0.4.0": mermaid

#figure(
  mermaid(read("diagrams/measurement.mmd"), width: 100%),
  caption: [One round of the measurement.],
) <fig:measurement>
```

Inline, as code blocks with the language `mermaid`:

````typ
#import "@preview/merman:0.4.0": show-mermaid-blocks
#show raw.where(lang: "mermaid"): show-mermaid-blocks(width: 100%)

```mermaid
flowchart LR
  Generate[Generate document] --> Cold[Compile cold]
  Cold --> Edit[Change one word] --> Warm[Compile again]
```
````

- In the Visual view an inline diagram is a code block (language `mermaid`); the preview shows the diagram.
- The first use downloads 3.3 MB (then cached by the browser) and adds about a second to the compile; a diagram edit takes about 0.3 s.

== Files <guide-features-files>

The file panel shows the project as a tree: folders first, the main file marked, collaborators' initials on the files they are in.

- "New" (`+`): New file, New spreadsheet, New diagram, New folder, Upload files, into the focused row's folder.
- A row's context menu (right click, Shift+F10): New file, New folder, Upload files, Rename, Delete (a folder with every file in it).
- Drag rows onto folders to move them; drop files from the desktop to upload them.
- Keyboard: arrows, Home / End, Enter, F2 (rename), Delete, Shift+F10 (menu).
- The main file and its folder cannot be renamed, moved or deleted.
- Below 720 px the panel lies over the editor.

How each file opens (a file with several editors gets a tab each, like Visual / Source; the one picked last is used for the next such file):

#table(
  columns: 2,
  [File], [Opens in],
  [`.typ`], [Its own Visual and Source views.],
  [Images], [A preview; drag into the Visual view to insert.],
  [`.csv`, `.json`, `.yaml`, `.yml`, `.toml`, `.xml`, `.bib`, `.txt`, `.md`, `.mmd`], [A plain text editor, saved as you type.],
  [`.ic`], [A spreadsheet (@guide-features-spreadsheets).],
  [`.drawio.png`], [The diagram editor (@guide-features-diagrams); its "Image" tab shows the picture.],
  [Anything else], [Name, size and type.],
)

File links:

```typ
#include "chapters/method.typ"
#let runs = csv("data/runs.csv")
#bibliography("references.bib")
```

- Paths in `#import`, `#include`, `image`, `read`, `bibliography`, `json` / `csv` / `yaml` / `toml` / `xml` / `cbor` open their file: Ctrl+click or Alt+Enter (⌘-click or ⌥↩ on Mac) in the Source view, "Open …" above a raw box in the Visual view.
- A missing `.typ` file can be created from there.
- A file the main file includes gets "← previous file" / "next file →" links in reading order.

== Comments <guide-features-comments>

Comments are #link("https://typst.app/universe/package/drafting/")[drafting] margin notes in the Typst source: they travel through saves, git, diffs and collaboration like any other text.

Select "grows linearly", press Ctrl+Alt+M (⌘⌥M on Mac), type the note; a co-author replies on the card. The file then holds:

```typ
#import "@preview/drafting:0.2.2": margin-note, set-margin-note-defaults
#set-margin-note-defaults(…)   // the notes' look, added with the first note

Cold compile time #margin-note[grows linearly][- *Ada* (2026-10-10): Linear up to 100 pages only? Add the 500-page run.
- *Grace* (2026-10-11): Running it tonight.] with the page count.
```

What Grace sees in the Visual view: "grows linearly" highlighted, and beside it a card in the notes gutter (buttons drawn as words):

```
┌────────────────────────────────────────────┐
│ grows linearly                 [Resolve ✓] │
│ Ada  2026-10-10                            │
│ Linear up to 100 pages only? Add the       │
│ 500-page run.                              │
│ Grace  2026-10-11          [Edit] [Delete] │
│ Running it tonight.                        │
│ [ Reply…                        ] [Send]   │
└────────────────────────────────────────────┘
```

- Add: "Comment" (Visual view toolbar or selection bar, Source view tab bar) or Ctrl+Alt+M (⌘⌥M on Mac). Without a selection: a point note at the cursor.
- A note is a thread: one list item per message, signed with your name and the date.
- On the card: reply (Ctrl+Enter sends, ⌘↩ on Mac), edit your own and unsigned messages, delete your last one, Resolve (deletes the note).
- The preview shows the notes in the page margin.
- A page margin given as one length (`#set page(margin: 1.5cm)`) becomes `margin: (right: 4cm, rest: 1.5cm)` with the first note: drafting needs room on the right.

== PDF <guide-features-pdf>

- "Download PDF" (preview toolbar) opens the export options: "Include comments" (off: the final version, notes removed; a range note keeps its text). Choices are kept for the browser session.
- The file is named after the main file (`main.pdf`).
- With errors there is no PDF; a message says why.

Refusals and failures (a refused rename, no PDF, a failed save) appear as messages at the bottom right; values the editor needs (a file name, a commit message) are asked in a small input box.

== Collaboration and GitLab <guide-features-collaboration>

Where the host enables it:

- Several people edit at once: cursors with names, the others' files marked in the file panel (@guide-collaboration).
- "Save to GitLab…" (tab bar) commits every change since the last save to the room's branch (@guide-collaboration-gitlab).
