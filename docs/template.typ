// The look of the documentation, for the book (main.typ, PDF) and the HTML site (site.typ):
// Sandstorm's, after sandstorm.de. Use: `#show: book`. Writers need nothing from here but
// `mermaid` for a diagram: plain headings, `@label` references, raw blocks and tables.
//
// Labels: a chapter's label is its path without `.typ` and the numbers that order the files, `/` → `-`
// (`30_architecture/07_workbench.typ` → `<architecture-workbench>`); a section inside appends a word
// (`<architecture-workbench-menus>`).

#import "@preview/merman:0.4.0"

/// sandstorm.de's colors; style.css has the same.
#let colors = (
  primary: rgb("#257792"),
  dark: rgb("#0f4a60"),
  sand: rgb("#f8c666"),
  ink: rgb("#222222"),
  muted: rgb("#605d5d"),
  line: rgb("#c2dbe4"),
  tint: rgb("#eef5f7"),
)

/// sandstorm.de's font: Gabarito, in fonts/ (SIL Open Font License 1.1, fonts/OFL.txt). A project
/// font: the editor uses it as typst.app does, `mise run docs:pdf` passes `--font-path docs/fonts`.
/// Code keeps Typst's DejaVu Sans Mono (the site's Ubuntu Mono lacks box-drawing characters).
#let font = "Gabarito"

#let company = "Sandstorm Media GmbH"

/// merman's `mermaid` in the docs' colors and font. A diagram is a file in `diagrams/`:
/// `#figure(mermaid(read("../diagrams/x.mmd"), width: 80%), caption: […]) <fig:x>`.
#let mermaid = merman.mermaid.with(
  site-config: (flowchart: (wrappingWidth: 320)),
  theme-name: "base",
  theme: (
    primaryColor: colors.line.to-hex(),
    primaryBorderColor: colors.primary.to-hex(),
    primaryTextColor: colors.dark.to-hex(),
    secondaryColor: colors.tint.to-hex(),
    tertiaryColor: colors.tint.to-hex(),
    lineColor: colors.primary.to-hex(),
    textColor: colors.dark.to-hex(),
    noteBkgColor: colors.sand.to-hex(),
    noteBorderColor: colors.sand.to-hex(),
    noteTextColor: colors.ink.to-hex(),
  ),
  typography: (font: font),
)

/// The first page: logo, book title, company.
#let title-page(it) = page(header: none, footer: none, margin: (x: 2.6cm, y: 2.4cm), {
  image("assets/sandstorm-logo.svg", width: 5.5cm)
  v(1fr)
  text(fill: colors.primary, weight: "bold", size: 11pt, tracking: 0.12em, upper[Documentation])
  v(0.4em)
  // the title's own spacing below is in em of 34pt: too far from the bar
  block(below: 12pt, text(fill: colors.dark, size: 34pt, weight: "bold", it))
  line(length: 3.2cm, stroke: 5pt + colors.sand)
  v(2fr)
  text(fill: colors.muted, size: 9pt)[#company · #link("https://sandstorm.de")[sandstorm.de]]
})

/// The current chapter (level 2) on pages that do not start one; the book's title before the first.
#let running-header(book-title) = context {
  let page = here().page()
  let starts = query(heading.where(level: 1).or(heading.where(level: 2)))
    .any(h => h.location().page() == page)
  if starts { return }
  let chapters = query(heading.where(level: 2).before(here()))
  set text(size: 8.5pt, fill: colors.muted)
  grid(
    columns: (1fr, auto),
    book-title,
    if chapters != () {
      let chapter = chapters.last()
      text(fill: colors.primary, numbering(chapter.numbering, ..counter(heading).at(chapter.location())))
      h(0.5em)
      chapter.body
    },
  )
  v(-0.5em)
  line(length: 100%, stroke: 0.5pt + colors.line)
}

#let footer = context {
  set text(size: 8.5pt, fill: colors.muted)
  grid(
    columns: (1fr, auto),
    company,
    text(fill: colors.primary, weight: "bold", counter(page).display()),
  )
}

#let book(body) = {
  set text(lang: "en")
  // `@label` references need numbered headings ("Section 3.2").
  set heading(numbering: "1.1")
  show table.cell.where(y: 0): strong

  // Paged-only styling: the HTML site gets its look from style.css.
  show: body => context {
    if target() != "paged" { return body }
    set text(font: font, size: 10.5pt)
    // Gabarito has no italics
    show emph: set text(weight: "semibold", fill: colors.dark)
    set text(fill: colors.ink)
    set page(
      paper: "a4",
      margin: (x: 2.4cm, top: 2.6cm, bottom: 2.4cm),
      header: running-header(document.title),
      footer: footer,
    )
    set par(justify: true, leading: 0.68em, spacing: 1.15em)

    show title: it => title-page(it) + counter(page).update(1)

    // a new page for every part (level 1) and chapter (level 2, see main.typ)
    show heading: set text(fill: colors.dark)
    show heading: set block(above: 1.6em, below: 0.8em)
    show heading: it => {
      if it.numbering == none { return it }
      let number = text(fill: colors.primary, counter(heading).display(it.numbering))
      block(number + h(0.6em) + it.body)
    }
    show heading.where(level: 1, outlined: true): it => {
      pagebreak(weak: true)
      v(4cm)
      // the bar as a block right below: a line alone is a paragraph, a 28pt line high with the spacing around it
      block(below: 16pt, text(size: 28pt, it))
      block(above: 16pt, line(length: 3.2cm, stroke: 5pt + colors.sand))
    }
    show heading.where(level: 2): set text(size: 20pt)
    show heading.where(level: 2): it => pagebreak(weak: true) + v(1cm) + it
    show heading.where(level: 3): set text(size: 13.5pt)
    show heading.where(level: 4): set text(size: 11pt)

    show outline.entry.where(level: 1): set block(above: 1.4em)
    show outline.entry.where(level: 1): set text(weight: "bold", fill: colors.dark)

    show link: set text(fill: colors.primary)
    show ref: set text(fill: colors.primary)

    show raw: set text(size: 0.95em)
    show raw.where(block: false): box.with(fill: colors.tint, inset: (x: 2pt), outset: (y: 2.5pt), radius: 2pt)
    show raw.where(block: true): block.with(
      fill: colors.tint,
      inset: (x: 10pt, y: 9pt),
      radius: (right: 3pt),
      stroke: (left: 2pt + colors.primary),
      width: 100%,
    )

    set table(
      inset: (x: 7pt, y: 6pt),
      stroke: (_, y) => (bottom: 0.5pt + colors.line),
      fill: (_, y) => if y == 0 { colors.line } else if calc.even(y) { colors.tint },
    )
    show table: set par(justify: false)
    show table.cell.where(y: 0): set text(fill: colors.dark)
    body
  }
  body
}
