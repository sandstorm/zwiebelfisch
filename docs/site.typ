// The documentation as HTML pages (Typst's bundle export): `mise run docs:html`.
// One page per chapter (`guide/embedding.typ` → `guide/embedding.html`), an index page with the
// outline, style.css copied next to them. `@label` references link across pages.
#import "template.typ": book
#import "main.typ": parts

#show: book

#document("index.html", title: "Typst editor")[
  #html.link(rel: "stylesheet", href: "style.css")
  #title[Typst editor]
  #outline(depth: 2)
]

#for part in parts {
  for (i, (path, title)) in part.chapters.pairs().enumerate() {
    document(path.replace(".typ", ".html"), title: title, {
      html.link(rel: "stylesheet", href: "../style.css")
      html.nav(link("../index.html")[Contents])
      // the part's heading opens its first chapter page, so the outline groups like the book's
      if i == 0 { heading(part.title) }
      set heading(offset: 1)
      include path
    })
  }
}

#asset("style.css", read("style.css"))
