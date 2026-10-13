#import "../template.typ": example

= Custom styles <features-custom-styles>
#set heading(outlined: false)

#strong[A Typst function with a `/// @style` doc comment becomes an entry in the text style menu.] This can be used for use cases like:

- custom *Notes* block elements (similar for warning, danger, tip)
- custom inline styles, e.g. for displaying text as Keyboard Shortcut
- \... anything else you can build with Typst :-)

== Discovery of Styles



All Typst sources of the project are scanned for comments like `/// @style (block|inline) <NameOfStyle>` , directly in front of a variable declaration, like in the following example.

By convention, these styles reside in `styles.typ`, but any file is supported:

#example[
  ```typ
  // block: wraps whole paragraphs, lists, headings
  /// A hint set apart from the running text.
  /// @style block Tip
  #let tip(body) = block(
    width: 100%,
    inset: (x: 10pt, y: 8pt),
    stroke: (left: 2.5pt + rgb("#3a8f4f")),
    fill: rgb("#eaf5ec"),
    [*Tip.* #body],
  )

  // inline: wraps a run of text inside a paragraph
  /// A key to press, like a key cap.
  /// @style inline Key
  #let key(body) = box(
    inset: (x: 3pt),
    outset: (y: 2pt),
    radius: 2pt,
    stroke: 0.5pt + luma(150),
    fill: luma(245),
    text(size: 0.85em, body),
  )

  Press #key[⌘] + #key[S] to save a copy.

  #tip[Press #key[Shift] twice to search everywhere.]
  ```
]

The Visual editor shows a block style as a named frame, an inline style underlined; the preview shows the real look.

- Pick a style from the text style menu, or from Styles in the bar above a selection.
- *Normal text* removes a block style.
- "New style…" adds a block style to `styles.typ`, you can then customize.
