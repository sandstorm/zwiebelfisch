= Mermaid diagrams <features-mermaid-diagrams>
#set heading(outlined: false)

== What it does

Mermaid diagrams are text, drawn by the #link("https://typst.app/universe/package/merman/")[merman] package while Typst compiles.

From a file (`diagrams/measurement.mmd`, opens in the text editor):

```typ
#import "@preview/merman:0.4.0": mermaid

#figure(
  mermaid(read("diagrams/measurement.mmd"), width: 100%),
  caption: [One round of the measurement.],
) <fig:measurement>
```

Inline, as code blocks with the language `mermaid`:

````typ
#import "@preview/merman:0.4.0": show-mermaid-blocks
#show raw.where(lang: "mermaid"): show-mermaid-blocks(width: 100%)

```mermaid
flowchart LR
  Generate[Generate document] --> Cold[Compile cold]
  Cold --> Edit[Change one word] --> Warm[Compile again]
```
````

The preview shows the drawn diagrams. In the Visual editor the figure shows the diagram, and an inline diagram is a code block (language `mermaid`, @features-code-blocks).

- Insert → Insert Mermaid diagram (or `/mermaid`): creates a `.mmd` with a starter flowchart (proposed: `diagrams/diagram.mmd` next to the file), inserts its figure with the import and opens it in the text editor.
- The picture of a box reading a `.mmd` file is a link, "Edit diagram": Ctrl+click (⌘-click on Mac) on it, or Alt+Enter on the selected box, opens the file.
- The help shows Mermaid's basics while a `.mmd` file is open (@features-help).
- The first use downloads 3.3 MB (then cached by the browser) and adds about a second to the compile; a diagram edit takes about 0.3 s.

== Why

Diagrams as text: written in a few lines, diffed and merged like the rest of the document, laid out automatically.

== How to configure

Nothing to configure. The package comes from `packages.typst.org` (@features-full-typst-support).
