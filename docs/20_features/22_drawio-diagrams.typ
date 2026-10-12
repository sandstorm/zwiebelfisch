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

The Visual editor and the preview show the picture like any image (@features-images); in the Visual editor it also leads to the diagram editor.

- File panel → New → "New diagram…" creates one and opens it.
- Insert → Insert diagram (or `/diagram`): creates one (proposed: `diagrams/diagram.drawio.png` next to the file), inserts `#figure(image("…"), caption: [ ])` and opens it.
- The picture of a diagram in the Visual editor is a link, "Edit diagram": Ctrl+click (⌘-click on Mac) on it, or Alt+Enter on the selected image, opens it in diagrams.net. Hovering says so; with Ctrl (⌘) held it shows as a link.
- Every change is saved into the file as you draw; there is no Save button.

== Why

Boxes-and-arrows drawings are drawn, not written; the file stays one image that any Typst compiler shows, with the diagram kept inside for the next edit.

== How to configure

`diagrams.editorUrl` (`'https://embed.diagrams.net/'`): where the draw.io editor comes from, e.g. your own installation of the drawio web app for use without internet access (@reference-configuration-diagrams). A host's Content-Security-Policy must allow it as a frame (@reference-embedding-library).
