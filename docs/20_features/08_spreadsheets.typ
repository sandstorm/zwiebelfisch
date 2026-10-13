= Spreadsheets <features-spreadsheets>
#set heading(outlined: false)

== What it does

#import "../template.typ": screenshot
#screenshot("spreadsheets")

The measured runs live in `data/runs.ic`, a spreadsheet edited in #link("https://www.ironcalc.com")[IronCalc]; the report shows the sheet as a table and quotes one value:

```typ
#import "data/runs.ic.gen.typ": sheets, values

#figure(sheets.Runs, caption: [Cold compile times (ms), three runs each.]) <tab:runs>

The 100-page document took #values.Runs.at(4).at(4) ms (median, @tab:runs).
```

The preview shows the table as it looks in the spreadsheet (column widths, fills, fonts, borders) and the value in the sentence; the Visual editor shows both as Typst draws them, the code while the cursor is in it.

- File panel → New → "New spreadsheet…" creates an `.ic` file and opens it in IronCalc: formulas, formats, several sheets.
- Insert → Insert spreadsheet (or `/spreadsheet`): names a new `.ic` (proposed: `data/table.ic` next to the file), fills in a starter table, inserts `#figure(sheets.Sheet1, caption: [ ])` with its import and opens the spreadsheet. If `sheets` already names another spreadsheet's tables, the new one is imported as `table-sheets`.
- Ctrl+click (⌘-click on Mac) or Alt+Enter on the path `data/runs.ic.gen.typ` ("Edit spreadsheet") opens the spreadsheet, not the generated file.
- Every edit also writes `<name>.ic.gen.typ` (generated; don't edit). It holds, by sheet name:
  - `sheets`: each sheet as a `table` that looks like the spreadsheet (column widths, fills, fonts, borders).
  - `values`: the displayed cells as strings, row by row: `values.Runs.at(1).at(0)` is A2.
- Named areas (IronCalc's defined names) are in the same file, by name:
  - `names`: a named cell as its displayed value (a string, as in `values`); a named range as a table of just its cells, looking like the sheet (as in `sheets`), so `#figure(names.Budget, caption: [ ])` works.
  - `name-values`: a named cell's string, a named range's displayed values row by row (`name-values.Budget.at(0).at(1)`).
  - A name defined for one sheet only is `Sheet!name`: `names.at("Runs!Median")`. A name that is no Typst identifier works the same way: `names.at("tax.rate")`.
  - A range ends at the sheet's last row and column with data (whole columns too). Names of a constant or an expression (not a cell or range) are left out.

  ```typ
  #import "data/budget.ic.gen.typ": names

  The trip costs #names.Total € in total.
  #figure(names.Budget, caption: [The trip's costs.])
  ```
- The preview follows every edit of the spreadsheet.
- Not supported: merged cells, `.xlsx` files.

== More examples

The examples use two spreadsheets: `data/runs.ic`, a sheet `Runs` whose first row holds the column titles (Pages, Run 1, Run 2, Run 3, Median), and `data/budget.ic`, with named areas.

Only some columns, in a table of the document's own look (`values` are the cells as shown, as strings):

```typ
#import "data/runs.ic.gen.typ": values

#table(
  columns: 2,
  table.header[*Pages*][*Median (ms)*],
  ..values.Runs.slice(1).map(row => (row.at(0), row.at(4))).flatten(),
)
```

A list made from the rows:

```typ
#for row in values.Runs.slice(1) [
  - #row.at(0) pages: #row.at(4) ms
]
```

A number computed in the spreadsheet, named there `Total`, in a sentence:

```typ
#import "data/budget.ic.gen.typ": names

The project costs #names.Total € in total.
```

A part of a sheet, the range named `Summary`, as a figure; smaller than the text width:

```typ
#import "data/budget.ic.gen.typ": names

#figure(
  scale(80%, reflow: true, names.Summary),
  caption: [The budget at a glance.],
) <tab:summary>
```

A number turned into a value Typst can compute with (`values` are strings):

```typ
#import "data/runs.ic.gen.typ": values

#let median = float(values.Runs.at(4).at(4))
The 100-page document took #calc.round(median / 1000, digits: 2) s.
```

== Why

Numbers that are computed (sums, averages, conversions) stay correct when the data changes, and the document shows them without copying.

== How to configure

Nothing to configure.
