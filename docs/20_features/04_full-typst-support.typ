= Full Typst support <features-full-typst-support>
#set heading(outlined: false)

#import "../template.typ": example

== What it does

Every Typst document opens and compiles, also what the Visual editor has no construct for: math, function calls, set and show rules, scripting, packages. A report's measurements, a helper computing from them, a formula and a table built by a loop:

#example[
  ```typ
  #let runs = (
    (pages: 1, cold: 41, incremental: 9),
    (pages: 10, cold: 180, incremental: 11),
    (pages: 100, cold: 1650, incremental: 14),
  )
  #let speedup(run) = calc.round(run.cold / run.incremental, digits: 1)

  The speed-up of an incremental compile for a document of $p$ pages is

  $ s(p) = (t_"cold" (p)) / (t_"incremental" (p)) $

  #table(
    columns: 4,
    align: (left, right, right, right),
    table.header[Pages][Cold (ms)][Incremental (ms)][Speed-up],
    ..for run in runs {
      (str(run.pages), str(run.cold), str(run.incremental), [#speedup(run) ×])
    },
  )

  For #runs.last().pages pages, an edit compiles #speedup(runs.last()) times faster.
  ```
]

The Visual editor shows each such piece as a *raw box*: here the `#let` lines, the formula and the table. A box shows its compiled look, cut from the preview, while the cursor is elsewhere; its Typst code, highlighted, while the cursor is in it. The two sentences around them stay text to edit. The preview shows the document as Typst compiles it.

- Math: type it as in Typst. `$a^1$` becomes inline math when the closing `$` is typed (Backspace right after gives the text back); `$ x^2 $` (spaces inside both dollars) alone on an empty line becomes display math, a block. Or Insert → Inline math / Display math (`/math`), which puts the cursor into the new formula. `\$` or a dollar with a space on one side only (`$5 and $10`) stays a dollar sign.
- A box's code is edited in CodeMirror, as in the Source editor: Tab / Shift+Tab indent / outdent.
- A box's picture leads where its code links to (a file, a diagram): Ctrl+click (⌘-click on Mac), or Alt+Enter on the selected box.
- Untouched source stays byte for byte; the Source editor always shows all of it.
- `#import "@preview/name:version"` works as on typst.app: the package is downloaded from `packages.typst.org` on first use and kept by the browser.

A document never has to be reduced to what a word processor can show: templates, packages and scripting keep working, and writers still edit the text around them.

== How to: the look of a document

The look of a whole document is set once, at its top, with *set rules* (`#set text(..)`: every text from here on) and *show rules* (`#show heading: ..`: how every heading looks). Put them in the main file, or in a template file the main file imports. The Visual editor shows them as raw boxes; the text below them stays text to edit. Each example below is a whole document: copy it into an empty file.

=== Fonts and text

#example[
  ```typ
  #set text(font: "Gabarito", size: 11pt, lang: "en")
  #set par(justify: true, leading: 0.7em)

  Typst compiles a document in milliseconds, so the preview follows every keystroke. The font is one of the project's files: any `.ttf` or `.otf` uploaded counts.
  ```
]

- `font`: a font of the project (any `.ttf`, `.otf`, `.ttc` or `.otc` file in it) or one of Typst's own (Libertinus Serif, New Computer Modern, DejaVu Sans Mono). A list tries each in turn: `("Gabarito", "Libertinus Serif")`.
- `lang` also sets the spell check's language and the hyphenation.

=== Headings

#example[
  ```typ
  #set heading(numbering: "1.1")
  #show heading: set text(fill: rgb("#257792"))
  #show heading: set block(below: 1em)

  = Results
  The incremental compile stays below 15 ms.

  == Cold compiles
  They grow with the page count.
  ```
]

- `numbering`: `"1."`, `"1.1"`, `"I.a"`, … or `none`.
- `show heading: set ..` changes every heading; `show heading.where(level: 1): ..` only one level. A show rule with a function (`it => ..`) replaces the heading's look entirely.

=== Lists

#example[
  ```typ
  #set list(marker: ([•], [–]), indent: 0.5em)
  #set enum(numbering: "a)")

  - Measure cold compiles
    - from 1 to 100 pages
  - Measure incremental ones

  + Generate the documents
  + Compile each one twice
  ```
]

- `list` is the bulleted list (`- `), `enum` the numbered one (`+ `). A marker per nesting level: `marker: ([•], [–])`.
- `numbering` as for headings: `"1."`, `"a)"`, `"i."`.

=== Page size, margins and page numbers

#example[
  ```typ
  #set page(paper: "a5", margin: (x: 2cm, y: 2.5cm), numbering: "1")

  = Compile times
  Writers want to see their document while they type. This report measures how long that takes.

  #line(length: 100%)

  The numbers are illustrative.

  #pagebreak()

  = Results
  #columns(2)[
    A cold compile grows with the length of the document.

    #colbreak()
    An incremental compile stays short: it redoes only what an edit touches.
  ]
  ```
]

The Visual editor shows the page break as a dashed divider labelled "Page break", the line as a horizontal rule, and `#set page(..)` and the columns as raw boxes; the preview starts a new page and draws the line, as above.

- Page break: Ctrl+Enter (⌘↩ on Mac), or Insert → Insert page break.
- Horizontal rule: Insert → Horizontal rule, or `---` at the start of an empty paragraph.
- "Page guides" in the View menu draws the text area, header and footer in the preview.

=== A title page

#example[
  ```typ
  #set page(paper: "a6", margin: 1.5cm)

  #align(center + horizon)[
    #text(size: 20pt, weight: "bold")[Compile times]

    A report on incremental compilation

    #v(2em)
    Ada Lovelace · October 2026
  ]

  #pagebreak()

  = Introduction
  Writers want to see their document while they type.
  ```
]

- `align(center + horizon)` puts the block in the middle of the page; `v(2em)` is vertical space.
- To keep the page number off the title page, set the numbering after it: `#set page(numbering: "1")` below the `#pagebreak()`, and `#counter(page).update(1)` to start counting there.

More: #link("https://typst.app/docs/tutorial/")[Typst's tutorial] and #link("https://typst.app/docs/reference/")[reference].

== How to configure

- Packages: a host's Content-Security-Policy must allow `connect-src https://packages.typst.org`.
