= draw.io diagrams <features-drawio-diagrams>
#set heading(outlined: false)

== What it does

#import "../template.typ": screenshot
#screenshot("drawio-diagrams")

A `.drawio.png` is a PNG with a diagrams.net diagram inside: Typst shows it as an image, the editor opens it in diagrams.net.

```typ
#figure(
  image("diagrams/architecture.drawio.png", width: 80%),
  caption: [The editor, the compile worker and the preview.],
) <fig:architecture>
```

The Visual editor and the preview show the picture like any image; in the Visual editor it also leads to the diagram editor.

- File panel → New → "New diagram…" creates one and opens it.
- Insert → Insert diagram (or `/diagram`): creates one (proposed: `diagrams/diagram.drawio.png` next to the file), inserts `#figure(image("…"), caption: [ ])` and opens it.
- The picture of a diagram in the Visual editor is a link, "Edit diagram": Ctrl+click (⌘-click on Mac) on it, or Alt+Enter on the selected image, opens it in diagrams.net. Hovering says so; with Ctrl (⌘) held it shows as a link.
- Every change is saved into the file as you draw; there is no Save button.

== More examples

A diagram without a caption, as a small picture in the text:

```typ
#image("diagrams/logo.drawio.png", width: 3cm)
```

Two diagrams side by side, one figure with one caption:

```typ
#figure(
  grid(
    columns: 2,
    gutter: 1em,
    image("diagrams/before.drawio.png"),
    image("diagrams/after.drawio.png"),
  ),
  caption: [The compile pipeline before and after caching.],
) <fig:pipeline>
```

The diagram as the background of a title page, the title written over it:

```typ
#page(background: image("diagrams/cover.drawio.png", width: 100%))[
  #align(center + horizon, text(size: 24pt)[Compile times])
]
```

The text refers to a labelled diagram as to any figure: `@fig:pipeline shows where the time goes.`

== Why

Boxes-and-arrows drawings are drawn, not written; the file stays one image that any Typst compiler shows, with the diagram kept inside for the next edit.

== How to configure

`diagrams.editorUrl` (`'https://embed.diagrams.net/'`): where the draw.io editor comes from, e.g. your own installation of the drawio web app for use without internet access. A host's Content-Security-Policy must allow it as a frame.
