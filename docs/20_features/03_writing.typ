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


- Insert → *Add label*: type the name into a new tag (`fig:`, `tab:` or `sec:` to start with).

- Type `@` for adding a cross-reference.
- Copy and paste re-labels if needed, and updates references.
