#let runs = (
  (pages: 1, cold: 41, incremental: 9),
  (pages: 10, cold: 180, incremental: 11),
  (pages: 100, cold: 1650, incremental: 14),
)
#let speedup(run) = calc.round(run.cold / run.incremental, digits: 1)

The speed-up of an incremental compile for a document of $p$ pages is

$ s(p) = (t_"cold" (p)) / (t_"incremental" (p)) $

#table(
  columns: 4,
  align: (left, right, right, right),
  table.header[Pages][Cold (ms)][Incremental (ms)][Speed-up],
  ..for run in runs {
    (str(run.pages), str(run.cold), str(run.incremental), [#speedup(run) ×])
  },
)

For #runs.last().pages pages, an edit compiles #speedup(runs.last()) times faster.
