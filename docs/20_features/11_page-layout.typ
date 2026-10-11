= Page layout <features-page-layout>
#set heading(outlined: false)

== What it does

```typ
#set page(paper: "a4", margin: 2.5cm)
#outline()
#pagebreak()
= Introduction
…
#line(length: 100%)
```

The Visual editor shows the page break as a dashed divider labelled "Page break" and the line as a horizontal rule; the preview starts a new page and draws the line.

- Page break: Ctrl+Enter (⌘↩ on Mac), or Insert → Insert page break.
- Horizontal rule: Insert → Horizontal rule, or `---` at the start of an empty paragraph.
- Page size and margins are Typst code (`#set page(..)`): a raw box in the Visual editor (@features-full-typst-support), or the Source editor.
- "Page guides" in the View menu draws the text area, header and footer in the preview (@features-rendering-preview).

== How to configure

Nothing to configure.
