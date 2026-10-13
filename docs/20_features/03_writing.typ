= Writing <features-writing>
#set heading(outlined: false)

#import "../template.typ": example, screenshot

In this section, we'll teach some Typst basics.

== Code blocks


To use *inline code*, use single backticks (``` ` ```); and for multiline code, use three backticks and the language (```` ```sh````). This supports *syntax highlighting*:

#example[
  ````typ
  Run `typst compile` for each document:

  ```sh
  for n in 1 10 100; do typst compile "doc-$n.typ"; done
  ```
  ````


]

== Images

An image in the text is usually added *as a figure with a caption and a label*:

#example[
  ```typ
  #figure(
    image("assets/sandstorm-logo.svg", width: 40%, alt: "The Sandstorm logo"),
    caption: [The company's logo.],
  ) <fig:logo>

  The title page shows the logo of @fig:logo.
  ```
]

The Visual editor shows the picture at its width with the caption below it. You can 

#pagebreak()

#screenshot("im ages")

- Insert → Insert image: pick one of the project's images, "Upload image…" or "Enter a path…".
- Drop or paste image files into the text: they are uploaded to the folder holding most of the project's images (without any: `images/` at the top of the project) and inserted (a second `image.png` becomes `image-2.png`).
- Drag an image from the file panel into the text to insert it there.
- PNG, JPEG, GIF, SVG and WebP.
- A selected image has a bar above it: "Caption" asks for the caption (a new one wraps the image in `#figure`, an empty one removes it), and the widths 25 / 50 / 75 / 100 % of the text. Drag a corner or side to set any width; double-click the picture for its code.
- A figure whose caption you write gets a label named after it once you leave the caption (`The company's logo.` → `<fig:company-logo>`), unless it has one.
- Deleting a selected image in a figure deletes the figure, caption and all.
- The caption is text like any other, so it can contain formatting, references, comments, or any other Typst element.
- A label on the figure lets the text refer to it via the `@` syntax.

== Tables

A Typst `#table` can be edited in the Visual editor:

#example[
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
]

The Visual editor shows a grid with a header row and the caption below; the preview shows the table as Typst sets it.

- Insert → Insert table: a 2 × 2 `#table`.
- If you select fields, you get controls to manipulate the table, i.e. add row, add column, delete row, delete column, mark as header row.



- A table the Visual editor cannot edit stays a raw box.
- To use *tables with computation*, use the *spreadsheet* feature: @features-spreadsheets.

== Headings and table of contents

#example[
  ```typ
  #set heading(numbering: "1.1")
  #outline(depth: 2)

  = Introduction
  Why compile times matter.

  == Goals
  What we measure, and why.

  = Method
  How we measure.

  == Setup
  The machine and the documents.
  ```
]

These are normal Typst features.

- Text style menu: Heading 1–3. Or type `= `, `== `, `=== ` at a line start, or `# `, `## `, `### `.
- `#set heading(numbering: ..)` configures headline numbers.
- Table of contents is supported via `#outline()`.
- Search everywhere (shift shift) jumps to a heading: `#` and part of its text.

== Labels and cross-references

A label (`<labelname>`) names a heading, figure or table; a reference (`@labelname`) to it shows its number / reference in the text.

#example[
  ```typ
  = Results
  
  This is a reference to @tab:medians.

  #figure(
    text[...],
    caption: [...],
  ) <tab:medians>
  ```
]


The Visual editor shows `results` as a tag on the heading and each reference as a chip naming its target; the preview shows "Table 1" (its number), as above.



- Insert → Add label: type the name into a new tag (`fig:`, `tab:` or `sec:` to start with).
- Select text in a block without a label: the selection's bar offers Add label, too.
- Click a tag: "Rename…" (updates the references in every file), "Rename without updating references…", "Remove label".
- Type `@` for a list of the project's labels, found by name or by what they label. Enter, Tab or a click inserts the reference; so does a space or punctuation right after a whole name (`@intro.`).
- A reference to a missing label is marked.
- A reference, and `#link(<label>)[..]`, leads to its label, in whichever file: hovering says where ("Go to Figure · The measurement setup in method.typ (⌘+click or Alt+Enter)"); Ctrl+click (⌘-click on Mac) on it, or Alt+Enter on the selected chip or with the cursor in it, opens that file at the label. In the Source editor and the Visual editor alike; a plain click edits.
- Copy and paste never makes two labels of one name: a pasted label the project has already gets `-1`, `-2`, … (`<fig:setup-1>`), and the references to it inside the pasted text (`@fig:setup-1`) with it; references to labels not pasted keep pointing to the originals. A cut and pasted label keeps its name.
- Search everywhere finds labels and figures: `@` and part of a name or caption.

== Spelling

The browser checks the spelling of the Visual editor's text with its own checker and dictionaries; its context menu offers the corrections. In a document starting with `#set text(lang: "de", region: "AT")`, the words are checked as Austrian German; Typst hyphenates and quotes as in German, too:

#example[
  ```typ
  #set text(lang: "de", region: "AT")
  #set par(justify: true)

  Im Jänner wurden alle Dokumente zweimal übersetzt: „kalt“ und nach einer Änderung von einem Wort.
  ```
]

- The language is the document's: the first `#set text(lang: ..)` in the shown file, else in the main file, with its `region`. Without one, the browser's default language.
- Code is not checked: inline code, code blocks and raw boxes (math, labels, other Typst). Neither is the Source editor.
- The browser knows no project words: what it flags wrongly, it flags in every document.

== How to configure

- A host can refuse image uploads with the option `allowFileChange`.
- `spellcheck.enabled` (on by default) turns the spell check off.
