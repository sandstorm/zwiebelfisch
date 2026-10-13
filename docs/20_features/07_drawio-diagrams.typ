= draw.io diagrams <features-drawio-diagrams>
#set heading(outlined: false)

#import "../template.typ": screenshot, example

#screenshot("drawio-diagrams")

A `.drawio.png` is *a PNG with a #link("https://www.drawio.com/")[draw.io] diagram inside*: Typst shows it as an image, the editor opens it in draw.io.

- Insert → Insert diagram (or `/diagram`): creates one, inserts it as a figure and opens it.
- File panel → New → "New diagram…" can also be used.
- Every change is saved as you draw; there is no Save button.

== Examples

It is an image like any other, so everything Typst does with images works:

#example[
```typ
// a figure with a caption and a label: refer to it with @fig:architecture
#figure(
  image("diagrams/architecture.drawio.png", width: 60%),
  caption: [The architecture.],
) <fig:architecture>

// two diagrams side by side, one caption
#figure(
  grid(
    columns: 2,
    gutter: 1em,
    image("diagrams/before.drawio.png"),
    image("diagrams/after.drawio.png"),
  ),
  caption: [Before and after.],
)
```
]
