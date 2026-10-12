// The look of the documentation, for the book (main.typ, PDF) and the HTML site (site.typ):
// Sandstorm's, after sandstorm.de. Use: `#show: book`. Writers need nothing from here but
// `mermaid` for a diagram, `screenshot` for a picture of the editor and `example` for a Typst document
// with its result: plain headings, `@label` references, raw blocks and tables.
//
// Labels: a chapter's label is its path without `.typ` and the numbers that order the files, `/` → `-`
// (`40_architecture/07_workbench.typ` → `<architecture-workbench>`); a section inside appends a word
// (`<architecture-workbench-menus>`).

#import "@preview/merman:0.4.0"
#import "assets/screenshots/index.typ": screenshots

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

/// The book's left and right page margin, and the text width between them (A4).
#let margin-x = 2.4cm
#let text-width = 21cm - 2 * margin-x

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

/// A picture of the editor showing a feature, `assets/screenshots/<name>.png`: one per feature chapter that shows the
/// editor, named after its label without `features-` (`#screenshot("tables")`), taken by `mise run docs:screenshots`
/// (`tests/screenshots/features.spec.ts`). Typst cannot ask whether a file exists, so that task lists the pictures
/// taken in `assets/screenshots/index.typ`; for a name not listed a box says the picture is pending, and the book
/// compiles either way. `width: auto`: as large as on screen (a pixel 0.75pt, so its text about as large as the
/// book's), at most the text width.
#let screenshot(name, caption: none, width: auto) = {
  if name in screenshots {
    let path = "assets/screenshots/" + name + ".png"
    // the PNG's width in pixels: its header's first field
    let pixels = int.from-bytes(read(path, encoding: none).slice(16, 20), endian: "big", signed: false)
    let width = if width == auto { calc.min(pixels * 0.75pt, text-width) } else { width }
    return figure(image(path, width: width, alt: "Screenshot: " + name), caption: caption)
  }
  let pending = [Screenshot pending: `mise run docs:screenshots` (#name)]
  context if target() == "html" {
    html.div(class: "screenshot-pending", pending)
  } else {
    block(
      width: if width == auto { 100% } else { width },
      inset: 10pt,
      radius: 3pt,
      fill: colors.tint,
      stroke: (paint: colors.line, dash: "dashed"),
      text(size: 9pt, fill: colors.muted, pending),
    )
  }
}

/// Typst's own look for `example`'s result, not the book's: its text, headings (numbered apart from the book's and
/// left out of its outline), outline (listing the example's headings only), tables and links. `key` names the
/// example: the metadata around it bound what its outline lists.
#let plain-typst(key, body) = {
  set text(font: "Libertinus Serif", size: 11pt, fill: black, weight: "regular", lang: "en")
  set par(justify: false, leading: 0.65em, spacing: 1.2em, first-line-indent: 0pt)
  set heading(offset: 0, numbering: none, outlined: true, bookmarked: false)
  // the book's heading rules (a page per chapter, numbers in its color) replaced: none of them sees a heading here
  show heading: it => block(above: 1.4em, below: 1em, sticky: true, text(
    fill: black,
    weight: "bold",
    size: (15.4pt, 13.2pt).at(it.level - 1, default: 11pt),
    if it.numbering == none { it.body } else { counter(heading).display(it.numbering) + h(0.3em) + it.body },
  ))
  show emph: set text(weight: "regular", fill: black, style: "italic")
  show link: set text(fill: black)
  show ref: set text(fill: black)
  show outline.entry: set block(above: 0.65em)
  show outline.entry: set text(weight: "regular", fill: black)
  set outline(target: selector(heading).after(metadata.where(value: key)).before(metadata.where(value: key + "/end")))
  set table(inset: 5pt, stroke: 0.5pt + black, fill: none)
  show table.cell: set text(fill: black)
  // after the example, the book's numbers again: counted from the book's own headings (the example's are not
  // bookmarked), as the counter's value before the example would depend on the examples before it
  counter(heading).update(0)
  [#metadata(key)#body#metadata(key + "/end")]
  context counter(heading).update(query(heading.where(bookmarked: auto).before(here())).fold((), (numbers, it) => {
    if it.numbering == none { return numbers }
    // a step at its level, as Typst counts
    let numbers = numbers.slice(0, calc.min(it.level, numbers.len()))
    numbers += (0,) * (it.level - numbers.len())
    numbers.at(-1) += 1
    numbers
  }))
}

/// `example`'s result of a document setting its pages (`#set page(paper, width, height, margin, numbering,
/// columns)`): its pages, cut at `#pagebreak()`, side by side at half size. Evaluated from its text, so it imports
/// no files.
#let example-pages(source) = {
  let setting = source.match(regex("(?m)^#set page\((.*)\)[ \t]*$"))
  let args = eval("(" + setting.captures.at(0) + ",)")
  let papers = (a4: (21cm, 29.7cm), a5: (14.8cm, 21cm), a6: (10.5cm, 14.8cm), "us-letter": (8.5in, 11in))
  let (width, height) = papers.at(args.at("paper", default: "a4"))
  width = args.at("width", default: width)
  height = args.at("height", default: height)
  let margin = args.at("margin", default: calc.min(width, height) * 2.5 / 21)
  let margin = if type(margin) == dictionary { margin } else { (rest: margin) }
  let foot = margin.at("bottom", default: margin.at("y", default: margin.at("rest", default: 2.5cm)))
  let numbers = args.at("numbering", default: none)
  let parts = source.replace(setting.text, "").split(regex("(?m)^#pagebreak\(\)[ \t]*$"))
  let pages = parts.enumerate().map(((i, part)) => block(width: width, height: height, fill: white, clip: true, {
    set align(start)
    if numbers != none { place(bottom + center, dy: -foot / 2 + 0.4em, numbering(numbers, i + 1)) }
    pad(..margin, columns(args.at("columns", default: 1), eval(part, mode: "markup")))
  }))
  grid(
    columns: calc.min(pages.len(), 2),
    gutter: 10pt,
    ..pages.map(page => box(stroke: 0.5pt + colors.line, scale(50%, reflow: true, page))),
  )
}

/// A real-world example: the Typst source of the document `main` (a path from the docs folder,
/// `"/examples/custom-styles/main.typ"`), below it what Typst makes of it. `imports`: files it imports, shown above
/// it. A document setting its pages shows them at half size (`example-pages`); any other, an excerpt of a page.
#let example(main, imports: ()) = {
  let file(path) = {
    let name = path.split("/").last()
    context if target() == "html" { html.div(class: "example-file", name) } else {
      block(above: 1em, below: 0.4em, sticky: true, text(size: 8.5pt, weight: "bold", fill: colors.muted, name))
    }
    raw(read(path), block: true, lang: "typ")
  }
  for path in imports { file(path) }
  file(main)
  let source = read(main)
  let result = plain-typst(main, if source.contains(regex("(?m)^#set page\(")) {
    example-pages(source)
  } else {
    block(width: 12cm, inset: 1cm, fill: white, stroke: 0.5pt + colors.line, {
      set align(start)
      include main
    })
  })
  context if target() == "html" { html.div(class: "example-result", html.frame(result)) } else {
    block(above: 0.8em, below: 1.4em, width: 100%, align(center, result))
  }
}

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
  // levels a heading skips count 0: Getting started's sections (a part without chapters) are 1.1, not 1.0.1
  set heading(numbering: (..levels) => levels.pos().filter(n => n != 0).map(str).join("."))
  show table.cell.where(y: 0): strong
  // the headings of an `example` are not the book's
  set outline(target: heading.where(outlined: true, bookmarked: auto))

  // Paged-only styling: the HTML site gets its look from style.css.
  show: body => context {
    if target() != "paged" { return body }
    set text(font: font, size: 10.5pt)
    // Gabarito has no italics
    show emph: set text(weight: "semibold", fill: colors.dark)
    set text(fill: colors.ink)
    set page(
      paper: "a4",
      margin: (x: margin-x, top: 2.6cm, bottom: 2.4cm),
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
