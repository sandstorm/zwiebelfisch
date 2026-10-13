= draw.io diagrams <features-drawio-diagrams>
#set heading(outlined: false)

#import "../template.typ": screenshot

#screenshot("drawio-diagrams")

A `.drawio.png` is *a PNG with a #link("https://www.drawio.com/")[draw.io] diagram inside*: Typst shows it as an image, the editor opens it in draw.io.

- Insert → Insert diagram (or `/diagram`): creates one, inserts it as a figure and opens it.
- File panel → New → "New diagram…" creates one without inserting it.
- *⌘-click the picture* in the Visual editor (or Alt+Enter) to edit the diagram.
- Every change is saved as you draw; there is no Save button.

== Examples

It is an image like any other, so everything Typst does with images works:

```typ
// a figure with a caption and a label: refer to it with @fig:architecture
#figure(
  image("diagrams/architecture.drawio.png", width: 80%),
  caption: [...],
) <fig:architecture>

// a small picture in the text
#image("diagrams/logo.drawio.png", width: 3cm)

// two diagrams side by side, one caption
#figure(
  grid(
    columns: 2,
    gutter: 1em,
    image("diagrams/before.drawio.png"),
    image("diagrams/after.drawio.png"),
  ),
  caption: [...],
)

// the background of a title page
#page(background: image("diagrams/cover.drawio.png", width: 100%))[
  #align(center + horizon, text(size: 24pt)[Title])
]
```
