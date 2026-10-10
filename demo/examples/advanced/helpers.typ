// Small building blocks the chapters import with `#import "../helpers.typ": …`.

#import "template.typ": accent

/// A highlighted remark set apart from the running text.
#let note(body) = block(
  width: 100%,
  inset: (x: 10pt, y: 8pt),
  stroke: (left: 2.5pt + accent),
  fill: accent.lighten(92%),
  [*Note.* #body],
)

/// A duration in milliseconds, e.g. `ms(12.5)` → "12.5 ms".
#let ms(value) = [#value#h(0.2em)ms]
