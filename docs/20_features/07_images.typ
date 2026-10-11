= Images <features-images>
#set heading(outlined: false)

== What it does

#import "../template.typ": screenshot
#screenshot("images")

An image in the text, usually as a figure with a caption and a label:

```typ
#figure(
  image("assets/test-bench.jpg", width: 60%, alt: "Laptop running the benchmark"),
  caption: [The measurement setup.],
) <fig:setup>

All runs used the machine in @fig:setup.
```

The Visual editor shows the picture at its width with the caption below it, the label as a tag; the preview shows the numbered figure ("Figure 1: The measurement setup.").

- Insert → Insert image: pick one of the project's images, "Upload image…" or "Enter a path…".
- Drop or paste image files into the text: they are uploaded to the project's top folder and inserted (a second `image.png` becomes `image-2.png`).
- Drag an image from the file panel into the text to insert it there (@features-files).
- PNG, JPEG, GIF, SVG and WebP.
- A selected image has a toolbar: "Add caption" / "Remove caption" (wraps it in `#figure`), width 25 / 50 / 75 / 100 %, "Alt text", "Edit code". Drag a corner or side to set any width.
- The caption is text like any other: bold, references, comments.
- A label on the figure lets the text refer to it (@features-labels-and-references).

== How to configure

Nothing to configure. A host can refuse uploads with `allowFileChange` (@reference-configuration-options).
