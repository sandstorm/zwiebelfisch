= HTML preview <features-html-preview>

#import "/template.typ": unreviewed
#unreviewed
#set heading(outlined: false)

#import "../template.typ": screenshot

#screenshot("html-preview")

The preview shows your document as pages. *Click "HTML"* at the top of the preview to see it as a web page instead: what Typst's HTML export makes of it. "Pages" switches back, and the editor remembers your choice.

A document can be *a whole website*: one page per `#document`, and files next to them with `#asset`:

```typ
#document("index.html", title: "Home")[
  = Welcome
  Read #link("about.html")[about us].
]
#document("about.html", title: "About")[
  = About us
  We write in Typst.
]
#asset("style.css", read("style.css"))
```

- *The preview follows you:* put the cursor into the text of "About us", and the preview shows `about.html`, scrolled to that text. Text every page has (a header from your template) keeps the page you are on.
- *Links work:* a link to another page of the site opens it in the preview, a link to the web opens a new tab.
- *Warnings* about what HTML leaves out (a `pagebreak`, page margins) are underlined in the editor like any other.
- Zoom and page numbers are for pages; in HTML they are hidden.

*Try it on these docs:* they are such a website. Open the Documentation example, right click `site.typ` in the file panel → "Set as main file", click "HTML", then open a chapter and move the cursor around.

Typst's HTML export is experimental: some things look different than in the PDF (or are missing).
