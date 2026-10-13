= Full Typst support <features-full-typst-support>
#set heading(outlined: false)

#import "../template.typ": example

Typst can do way more than what is supported in the visual editor, e.g. math, function calls, scripting. Examples:

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

The Visual Editor *falls back to raw typst markup* for everything it does not understand.

*Math* works as follows: `$a^1$` becomes inline math $a^1$, and `$ x^2 $` a new math block:

$ x^2 $

*Imports* like `#import "@preview/name:version"` are auto-downloaded from `packages.typst.org` and cached.

== Customizing the look of a document

The look of a whole document is configured at the beginning:

- #strong[`#set` ]rules change the default arguments of element functions, e.g. `#set text(..)` targets every text from here on.

- `#show`#strong[ ]rules (`#show heading: ..`: how every heading looks). Put them in the main file, or in a template file the main file imports. The Visual editor shows them as raw boxes; the text below them stays text to edit. Each example below is a whole document: copy it into an empty file.

=== Fonts and text via \#set rules

#strong[`#set`] rules change the default arguments of element functions, e.g. `#set text(..)` targets every text from here on:

#example[```typ
Default text

#set text(font: "Gabarito", size: 20pt)
Big text

#set text(fill: blue)
Different color
```
]

#example[
  ```typ
  #set text(font: "Gabarito", size: 11pt, lang: "en")
  #set par(justify: true)

  Typst compiles a document in milliseconds, so the preview follows every keystroke. The font is one of the project's files: any `.ttf` or `.otf` uploaded counts.
  ```
]

=== Adjust rendering via \#show rules 

A `#show` rule basically says: _Whenever X appears, render Y instead_. 

#example[```typst
// whenever the string "Typst" appears, render it as red
#show "TYPST": text(red, weight: "bold")[Typst]

Hello TYPST Project
```

]

This can also take arguments:

#example[```typst
#let shout(body) = text(red, weight: "bold", body)

#shout[Hello] World
```]



You can also combine it with set rules:

#example[```typst
#let mystyle(body) = {
  set text(font: "New Computer Modern", 11pt)
  set heading(numbering: "1.")
  show "TYPST": text(red)[Typst]

  body
}

#mystyle[
  = Intro
  Hello TYPST
]

// Wrapping everything in [...] is ugly. #show: f means “pass everything below this line to f as body”:
#show: mystyle

= Intro
Hello TYPST
```]

==== Currying / setting default parameters

`.with(...)` pre-fills arguments and leaves `body` to be supplied by `show:`.

#example[```typst
#let note(title: none, author: none, body) = {
  set heading(numbering: "1.")
  show raw: set text(fill: maroon)

  text(18pt, weight: "bold", title)
  [\ #author]
  line(length: 100%)

  body
}

#show: note.with(title: [DB Migration Plan], author: "Jane Doe")

Some contents here
```]

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

=== List Styling

#example[
  ```typ
  *Default styles*

  - ...
    - ...

  + ...
  + ...

  *Adjusted styles*

  #set list(marker: ([•], [–]), indent: 0.5em)
  #set enum(numbering: "a)")

  - ...
    - ...

  + ...
  + ...
  ```
]

=== Page size, margins and page numbers

#example[
  ```typ
  #set page(paper: "a5", margin: (x: 2cm, y: 2.5cm), numbering: "1")

  #lorem(30)

  #pagebreak()

  #columns(2)[
    #lorem(5)

    #colbreak()

      #lorem(10)
  ]
  ```
]

=== A title page

#example[
  ```typ
  #set page(paper: "a6", margin: 1.5cm)

  // put the block in the middle of the page
  #align(center + horizon)[
    #text(size: 20pt, weight: "bold")[Compile times]

    A report on incremental compilation

    // vertical space
    #v(2em)

    Ada Lovelace · October 2026
  ]

  #pagebreak()

  = Introduction

  #lorem(30)
  ```
]

More: #link("https://typst.app/docs/tutorial/")[Typst's tutorial] and #link("https://typst.app/docs/reference/")[reference].
