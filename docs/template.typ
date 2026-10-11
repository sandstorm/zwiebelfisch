// The look of the documentation, for the book (main.typ, PDF) and the HTML site (site.typ).
// Use: `#show: book`. Writers need nothing from here: plain headings, `@label` references,
// raw blocks and tables.
//
// Labels: a chapter's label is its path without `.typ`, `/` → `-`
// (`architecture/workbench.typ` → `<architecture-workbench>`); a section inside appends a word
// (`<architecture-workbench-menus>`).

#let book(body) = {
  set text(lang: "en")
  // `@label` references need numbered headings ("Section 3.2").
  set heading(numbering: "1.1")
  set table(stroke: 0.5pt + luma(180), inset: 6pt)
  show table.cell.where(y: 0): strong

  // Paged-only styling: the HTML site gets its look from style.css.
  show: body => context {
    if target() != "paged" { return body }
    set page(paper: "a4", margin: 2.2cm, numbering: "1")
    set par(justify: true)
    show table: set par(justify: false)
    // a new page for every part (level 1) and chapter (level 2, see main.typ)
    show heading.where(level: 1, outlined: true): it => pagebreak(weak: true) + it
    show heading.where(level: 2): it => pagebreak(weak: true) + it
    show raw: set text(size: 0.85em)
    show raw.where(block: true): block.with(fill: luma(245), inset: 8pt, radius: 3pt, width: 100%)
    body
  }
  body
}
