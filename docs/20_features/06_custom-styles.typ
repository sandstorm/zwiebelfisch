= Custom styles <features-custom-styles>
#set heading(outlined: false)

== What it does

A block or inline style is a Typst function with a `/// @style` doc comment, in any `.typ` file of the project (usually `styles.typ`). A tip box and a key cap, and text using them (declared in the document itself here, so it is all in one place):

#import "../template.typ": example

#example[
  ```typ
  /// A hint set apart from the running text.
  /// @style block Tip
  #let tip(body) = block(
    width: 100%,
    inset: (x: 10pt, y: 8pt),
    stroke: (left: 2.5pt + rgb("#3a8f4f")),
    fill: rgb("#eaf5ec"),
    [*Tip.* #body],
  )

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

  Press #key[Ctrl] + #key[S] to save a copy; the editor keeps your changes anyway.

  #tip[Press #key[Shift] twice to search everywhere: files, headings and commands.]
  ```
]

- *block* wraps whole blocks (paragraphs, lists, headings). The Visual editor shows a named frame: *Tip* around the wrapped paragraphs, `#tip[…]` in the file.
- *inline* wraps a run of text inside a paragraph. The Visual editor shows it underlined: *Key* wraps the selection in `#key[…]`.
- The preview shows the real look, as above: the green bar of the tip, the frame of the key cap.
- The text style menu offers both and adds the import where needed.
- The bar above a text selection offers the inline styles too: Styles → *Key* (✓ where the selection has it: takes it off).
- Drag a block style's frame (its name or edge) to move it, call and all, as you drag selected text.
- *Normal text* removes a block style. "New style…" adds a block style to `styles.typ`.
- Search everywhere applies a style to the selection: `*` and its name.
- Calls of functions not declared as styles stay raw boxes.

== Why

A template's look (call-outs, warnings, terms) becomes a menu entry: writers apply it without writing the call, and the template author decides what it looks like.

== How to configure

Nothing to configure: the styles are the project's own, declared in its Typst files.
