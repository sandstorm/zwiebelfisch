// The look of the documentation, for the book (main.typ, PDF) and the HTML site (site.typ):
// Sandstorm's, after sandstorm.de. Use: `#show: book`. Writers need nothing from here but
// `mermaid` for a diagram, `screenshot` for a picture of the editor and `example` (a block style:
// `#example[```typ … ```]`) for a Typst document with its result: plain headings, `@label` references,
// raw blocks and tables.
//
// Labels: a chapter's label is its path without `.typ` and the numbers that order the files, `/` → `-`
// (`40_architecture/07_window.typ` → `<architecture-window>`); a section inside appends a word
// (`<architecture-window-menus>`).

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

/// The note under a chapter heading whose text nobody has rewritten and checked by hand yet (every part but
/// Features). Delete the call once a person has curated the chapter.
#let unreviewed = {
  let note = [*Not yet reviewed.* _This chapter has not been rewritten, curated or checked by hand yet._]
  // HTML (the primary output): the class `unreviewed` in style.css
  context if target() == "html" {
    html.div(class: "unreviewed", note)
  } else {
    block(width: 100%, inset: (x: 10pt, y: 7pt), fill: colors.tint, stroke: (left: 3pt + colors.sand), note)
  }
}

/// `numbers` (a heading counter's value) after a heading of `level`, as Typst steps it.
#let step-heading(numbers, level) = {
  let numbers = numbers.slice(0, calc.min(level, numbers.len()))
  numbers += (0,) * (level - numbers.len())
  numbers.at(-1) += 1
  numbers
}

/// The example's headings' own counter: they leave the book's `counter(heading)` alone.
#let example-headings = counter("example-headings")

/// Typst's own look for `example`'s result, not the book's: its text, headings (left out of the book's outline),
/// outline (listing the example's headings only), tables and links. `key` names the example: the metadata around it
/// bound what its outline lists. Its headings are numbered by `numbering` (its `#set heading(numbering: ..)`), from a
/// counter of their own: a heading Typst numbers would step the book's heading counter, and restoring that after the
/// example takes another layout pass (too many for the preview's guides, preview-guides.test.ts).
#let plain-typst(key, numbering: none, body) = {
  set text(font: "Libertinus Serif", size: 11pt, fill: black, weight: "regular", lang: "en")
  set par(justify: false, leading: 0.65em, spacing: 1.2em, first-line-indent: 0pt)
  set heading(offset: 0, outlined: true, bookmarked: false)
  show heading: set heading(numbering: none)
  let number(numbers) = if numbering != none { std.numbering(numbering, ..numbers) }
  // the book's heading rules (a page per chapter, numbers in its color) replaced: none of them sees a heading here;
  // numbered are the outlined ones (not an outline's title)
  show heading: it => {
    if it.outlined { example-headings.step(level: it.level) }
    block(above: 1.4em, below: 1em, sticky: true, text(
      fill: black,
      weight: "bold",
      size: (15.4pt, 13.2pt).at(it.level - 1, default: 11pt),
      if numbering == none or not it.outlined { it.body } else { context number(example-headings.get()) + h(0.3em) + it.body },
    ))
  }
  show emph: set text(weight: "regular", fill: black, style: "italic")
  show link: set text(fill: black)
  show ref: set text(fill: black)
  show outline.entry: set block(above: 0.65em)
  show outline.entry: set text(weight: "regular", fill: black)
  // the counter steps inside the heading, after the place the entry asks about
  show outline.entry: it => it.indented(number(step-heading(example-headings.at(it.element.location()), it.level)), it.inner())
  set outline(target: selector(heading).after(metadata.where(value: key)).before(metadata.where(value: key + "/end")))
  set table(inset: 5pt, stroke: 0.5pt + black, fill: none)
  show table.cell: set text(fill: black)
  example-headings.update(0)
  // its figures are numbered from 1, as in a document of its own, and taken off the book's count after it
  let kinds = (image, table, raw)
  context {
    let before = kinds.map(kind => counter(figure.where(kind: kind)).get().first())
    show: body => kinds.zip(before).fold(body, (it, (kind, n)) => {
      show figure.where(kind: kind): set figure(numbering: i => std.numbering("1", i - n))
      it
    })
    [#metadata(key)#body#metadata(key + "/end")]
  }
  context for kind in kinds {
    let inside = selector(figure.where(kind: kind)).after(metadata.where(value: key)).before(metadata.where(value: key + "/end"))
    let count = query(inside).len()
    if count > 0 { counter(figure.where(kind: kind)).update(i => i - count) }
  }
}

/// `example`'s result of a document setting its pages (`#set page(paper, width, height, margin, numbering,
/// columns)`): its pages, cut at `#pagebreak()`, side by side at half size.
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

/// The first code block in `body` (```typ … ```), searched through the content around it; none without one.
#let code-block(body) = {
  if body.func() == raw { return body }
  for child in body.at("children", default: ()) {
    let found = code-block(child)
    if found != none { return found }
  }
  if body.has("body") { code-block(body.body) }
}

/// A real-world example: the Typst code block in `body` (```typ … ```), highlighted, and next to it what Typst makes
/// of its text, in one frame headed "Typst" and "Result" (a document setting its pages: the pages below the code, at
/// half size, `example-pages`; any other: an excerpt of a page). A custom block style of the docs: the Visual editor
/// shows it as a block "Example" with the code block in it to edit. Self-contained on purpose: the code is evaluated
/// alone, without the chapter's imports and variables, so what the reader sees is the whole document and can be
/// copied into an empty file (an example using styles declares them itself). Its headings are numbered as its
/// `#set heading(numbering: ..)` line says.
/// @style block Example
#let example(body) = {
  let code = code-block(body)
  if code == none { panic("example: put the example's Typst code in its body as a code block, ```typ … ```") }
  let source = code.text
  let headings = source.match(regex("(?m)^#set heading\((.*)\)[ \t]*$"))
  let numbering = if headings != none { eval("(" + headings.captures.at(0) + ",)").at("numbering", default: none) }
  let pages = source.contains(regex("(?m)^#set page\("))
  let result = plain-typst("example:" + source, numbering: numbering, if pages { example-pages(source) } else {
    // half the text width: the result's column
    block(width: text-width / 2 - 0.6cm, inset: 0.4cm, fill: white, {
      set align(start)
      eval(source, mode: "markup")
    })
  })
  let source = raw(source, block: true, lang: "typ")
  context if target() == "html" {
    html.div(class: "example" + if pages { " example--pages" }, {
      html.div(class: "example-source", html.div(class: "example-label")[Typst] + source)
      html.div(class: "example-result", html.div(class: "example-label")[Result] + html.frame(result))
    })
  } else {
    // each half its label on a tinted strip above it, so a page break never parts the two
    let half(label, content) = {
      block(width: 100%, fill: colors.tint, inset: (x: 8pt, y: 5pt), below: 0pt, sticky: true,
        text(size: 7.5pt, weight: "bold", fill: colors.primary, tracking: 0.1em, upper(label)))
      content
    }
    block(above: 0.8em, below: 1.4em, width: 100%, breakable: pages, stroke: 0.5pt + colors.line, radius: 3pt, clip: true, {
      show raw.where(block: true): set text(size: 7.5pt)
      grid(
        columns: if pages { 1 } else { (1fr, 1fr) },
        stroke: (x, y) => (left: if x > 0 { 0.5pt + colors.line }, top: if y > 0 { 0.5pt + colors.line }),
        half[Typst][#source],
        half[Result][#block(inset: if pages { 8pt } else { 0pt }, align(center, result))],
      )
    })
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

/// The current chapter (level 2) on pages that do not start one; the book's title before the first. An `example`'s
/// headings (not bookmarked) are not the book's.
#let running-header(book-title) = context {
  let page = here().page()
  let starts = query(heading.where(level: 1, bookmarked: auto).or(heading.where(level: 2, bookmarked: auto)))
    .any(h => h.location().page() == page)
  if starts { return }
  let chapters = query(heading.where(level: 2, bookmarked: auto).before(here()))
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
