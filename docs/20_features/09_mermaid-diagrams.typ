= Mermaid diagrams <features-mermaid-diagrams>
#set heading(outlined: false)

#import "../template.typ": example

Mermaid diagrams are written as text and drawn by the #link("https://typst.app/universe/package/merman/")[merman] package while Typst compiles.

*Insert → Insert Mermaid diagram* (or `/mermaid`) creates a `.mmd` file with a starter flowchart, inserts its figure and opens the file in the text editor.

*⌘-click the diagram* in the Visual editor opens its `.mmd` file again.

== Diagrams from a file

```typ
#import "@preview/merman:0.4.0": mermaid

#figure(
  // the .mmd file opens in the text editor
  mermaid(read("diagrams/measurement.mmd"), width: 100%),
  caption: [One round of the measurement.],
) <fig:measurement>
```

== Inline diagrams

Write a code block with the language `mermaid`, as you know from Markdown:

#example[
  ````typ
  #import "@preview/merman:0.4.0": show-mermaid-blocks
  // render every mermaid code block as a diagram
  #show raw.where(lang: "mermaid"): show-mermaid-blocks(width: 100%)

  ```mermaid
  flowchart LR
    A[Write] --> B[Compile]
    B --> C[Read]
  ```
  ````
]

More: #link("https://mermaid.js.org/intro/")[Mermaid's documentation].
