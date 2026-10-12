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
