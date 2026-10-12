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
