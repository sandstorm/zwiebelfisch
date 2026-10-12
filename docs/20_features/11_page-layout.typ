= Page layout <features-page-layout>
#set heading(outlined: false)

== What it does

A report on A5 pages with numbers at the bottom, a rule, a page break and two columns:

#import "../template.typ": example

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
- Page size and margins are Typst code (`#set page(..)`): a raw box in the Visual editor (@features-full-typst-support), or the Source editor.
- "Page guides" in the View menu draws the text area, header and footer in the preview (@features-rendering-preview).

== How to configure

Nothing to configure.
