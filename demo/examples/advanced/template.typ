// The report's look in one place: main.typ applies it with
// `#show: template.with(...)`, the chapters only write content.

#let accent = rgb("#1d5fa8")

#let template(title: none, subtitle: none, authors: (), date: none, body) = {
  set document(title: title, author: authors)
  set page(
    paper: "a4",
    margin: (x: 2.4cm, top: 2.8cm, bottom: 2.5cm),
    numbering: "1",
    header: context {
      if counter(page).get().first() > 1 {
        set text(size: 9pt, fill: luma(110))
        title
        h(1fr)
        authors.join(", ")
      }
    },
  )
  set text(font: "Libertinus Serif", size: 11pt, lang: "en")
  set par(justify: true)
  set heading(numbering: "1.1")
  set math.equation(numbering: "(1)")
  set figure(gap: 0.8em)

  show heading.where(level: 1): it => {
    v(0.8em)
    set text(fill: accent, size: 15pt)
    it
    v(0.2em)
  }
  show figure.caption: set text(size: 9.5pt)
  show raw: set text(font: "DejaVu Sans Mono", size: 9pt)
  show raw.where(block: true): block.with(fill: luma(245), inset: 9pt, radius: 3pt, width: 100%)
  show link: set text(fill: accent)

  // Title block
  align(center)[
    #image("assets/logo.svg", width: 2.2cm)
    #v(0.4em)
    #text(size: 22pt, weight: "bold", fill: accent, title) \
    #if subtitle != none { text(size: 13pt, subtitle) }
    #v(0.6em)
    #authors.join([ #sym.dot.c ])
    #if date != none [ \ #date.display("[day]. [month repr:long] [year]") ]
  ]
  v(1.5em)

  body
}
