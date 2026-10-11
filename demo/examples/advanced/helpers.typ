// Small building blocks the chapters import with `#import "../helpers.typ": …`.
// `/// @style …` declares a function as a custom style: the Visual editor's text style menu offers it.

#import "template.typ": accent

/// A highlighted remark set apart from the running text.
/// @style block Note
#let note(body) = block(
  width: 100%,
  inset: (x: 10pt, y: 8pt),
  stroke: (left: 2.5pt + accent),
  fill: accent.lighten(92%),
  [*Note.* #body],
)

/// A term the report defines or relies on.
/// @style inline Term
#let term(body) = text(fill: accent, style: "italic", body)

/// A duration in milliseconds, e.g. `ms(12.5)` → "12.5 ms".
#let ms(value) = [#value#h(0.2em)ms]
