// The documentation as HTML pages (Typst's bundle export): `mise run docs:html`.
// One page per chapter (`guide/embedding.typ` → `guide/embedding.html`), an index page with the
// outline, style.css and the logo copied next to them. `@label` references link across pages.
#import "template.typ": book, company
#import "main.typ": parts

#show: book

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

#for part in parts {
  for (i, (path, title)) in part.chapters.pairs().enumerate() {
    document(path.replace(".typ", ".html"), title: title, site-page("../", {
      // the part's heading opens its first chapter page, so the outline groups like the book's
      if i == 0 { heading(part.title) }
      set heading(offset: 1)
      include path
    }))
  }
}

#asset("style.css", read("style.css"))
#asset("assets/sandstorm-logo.svg", read("assets/sandstorm-logo.svg"))
