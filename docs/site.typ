// The documentation as HTML pages (Typst's bundle export): `mise run docs:html`.
// One page per chapter (`30_configuration/02_embedding.typ` → `30_configuration/02_embedding.html`), an index page with the
// outline, style.css and the logo copied next to them. `@label` references link across pages.
// The chapters and parts come from main.typ's source: its `#include "…"` lines in order, and the `= …` part
// headings between them; a page's title is its chapter's first `= …` heading.
#import "template.typ": book, company

#show: book

#let book-source = read("main.typ")
#let parts = book-source.matches(regex("(?m)^= (.+)$")).map(m => (start: m.start, title: m.captures.at(0).trim()))
#let chapters = book-source.matches(regex("#include\s+\"([^\"]+)\"")).map(m => (start: m.start, path: m.captures.at(0)))

/// A chapter file's first `= …` heading, without its label.
#let chapter-title(path) = read(path).match(regex("(?m)^= (.+?)\s*(<[^>]*>)?\s*$")).captures.at(0)

/// What every page has around its content; `root` leads from the page to the site's top folder.
#let site-page(root, body) = {
  html.link(rel: "stylesheet", href: root + "style.css")
  html.header({
    link(root + "index.html", html.img(src: root + "assets/sandstorm-logo.svg", alt: "Sandstorm"))
    html.nav(link(root + "index.html")[Contents])
  })
  html.main(body)
  html.footer[#company · #link("https://sandstorm.de")[sandstorm.de]]
}

#document("index.html", title: "Typst editor", site-page("")[
  #title[Typst editor]
  #outline(depth: 3)
])

#for (i, chapter) in chapters.enumerate() {
  let after = if i == 0 { -1 } else { chapters.at(i - 1).start }
  let root = "../" * (chapter.path.split("/").len() - 1)
  document(chapter.path.replace(".typ", ".html"), title: chapter-title(chapter.path), site-page(root, {
    // a part's heading opens its first chapter page, so the outline groups like the book's
    for part in parts.filter(p => after < p.start and p.start < chapter.start) { heading(part.title) }
    set heading(offset: 1)
    include chapter.path
  }))
}

#asset("style.css", read("style.css"))
#asset("assets/sandstorm-logo.svg", read("assets/sandstorm-logo.svg"))
