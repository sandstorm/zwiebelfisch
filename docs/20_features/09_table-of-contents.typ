= Headings and table of contents <features-table-of-contents>
#set heading(outlined: false)

== What it does

#import "../template.typ": screenshot
#screenshot("table-of-contents")

```typ
#set heading(numbering: "1.1")
#outline(depth: 2)

= Introduction <intro>
== Goals
```

The Visual editor shows "Introduction" and "Goals" as headings of two sizes, their numbers 1 and 1.1 beside them, and the outline as a box headed "Table of contents" with the compiled outline in it; the preview shows the outline with its page numbers.

- Text style menu: Heading 1–3. Or type `= `, `== `, `=== ` at a line start, as in Typst (also `# `, `## `, `### `).
- Numbers appear in the Visual editor as `#set heading(numbering: ..)` makes Typst number them. The command "Number headings on / off" (search everywhere, @features-search-everywhere) adds `#set heading(numbering: "1.")` or removes the document's heading numbering.
- Insert → Table of contents: `#outline()`. Its code is edited as a raw box's (`depth`, `title`).
- Search everywhere jumps to a heading: `#` and part of its text (@features-search-everywhere).

== How to configure

Nothing to configure.
