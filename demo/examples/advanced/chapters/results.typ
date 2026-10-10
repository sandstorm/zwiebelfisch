#import "../helpers.typ": ms, note

= Results <results>

@tab:timings lists the medians. Cold compiles grow with the document, while
incremental compiles stay almost flat: an edit on the last page costs about the
same in a short and in a long document.

#figure(
  table(
    columns: 4,
    align: (left, right, right, right),
    stroke: (x, y) => if y == 0 { (bottom: 0.7pt) },
    table.header([*Pages*], [*Cold*], [*Incremental*], [*Speed-up*]),
    [1], ms(18), ms(4), [4.5×],
    [10], ms(95), ms(6), [15.8×],
    [50], ms(410), ms(9), [45.6×],
    [100], ms(820), ms(12), [68.3×],
  ),
  caption: [Median compile times (illustrative numbers).],
) <tab:timings>

@fig:compile-times shows the same data as bars: the dark bars are cold
compiles, the light ones incremental compiles after a one-word edit.

#figure(
  image("../assets/compile-times.svg", width: 70%),
  caption: [Cold (dark) and incremental (light) compile times for 1, 10, 50 and 100 pages.],
) <fig:compile-times>

== Discussion

The speed-up from @eq:speedup grows with the document, because the work an
incremental compile does depends on the edit, not on the document's length.

#note[The numbers in this report are made up for the demo. Edit them in
`chapters/results.typ` and watch the table update.]
