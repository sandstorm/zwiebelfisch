= Spreadsheets <features-spreadsheets>
#set heading(outlined: false)

#import "../template.typ": screenshot

#screenshot("spreadsheets")

An `.ic` file is *a spreadsheet you edit in #link("https://www.ironcalc.com")[IronCalc]*: formulas, formats, several sheets. The document shows its sheets as tables and quotes its values.

- Insert → Insert spreadsheet (or `/spreadsheet`): creates one with a starter table, inserts it as a figure and opens it.
- File panel → New → "New spreadsheet…" creates one without inserting it.
- *⌘-click the import path* (or Alt+Enter) to open the spreadsheet.
- Merged cells and `.xlsx` files are not supported.

Every edit writes `<name>.ic.gen.typ`, which you import. *Don't edit it.* It holds, by sheet name:

- `sheets`: each sheet as a `table` that looks like the spreadsheet (column widths, fills, fonts, borders).
- `values`: the displayed cells as strings, row by row.
- `names`, `name-values`: the same for IronCalc's named cells and ranges.

```typ
#import "data/runs.ic.gen.typ": sheets, values

#figure(sheets.Runs, caption: [...]) <tab:runs>

// row 5, column 5 (E5); counting starts at 0
The 100-page document took #values.Runs.at(4).at(4) ms.
```

== More examples

The examples use `data/runs.ic`, a sheet `Runs` with the columns Pages, Run 1, Run 2, Run 3, Median, and `data/budget.ic`, with named areas.

*Only some columns*, in a table of the document's own look:

```typ
#import "data/runs.ic.gen.typ": values

#table(
  columns: 2,
  table.header[*Pages*][*Median (ms)*],
  // skip the title row; take columns A and E
  ..values.Runs.slice(1).map(row => (row.at(0), row.at(4))).flatten(),
)
```

*A list* made from the rows:

```typ
#for row in values.Runs.slice(1) [
  - #row.at(0) pages: #row.at(4) ms
]
```

*Named areas* (IronCalc's defined names):

```typ
#import "data/budget.ic.gen.typ": names

// a named cell: its displayed value
The project costs #names.Total € in total.

// a named range: a table of just its cells, here smaller than the text width
#figure(
  scale(80%, reflow: true, names.Summary),
  caption: [...],
)

// a name defined for one sheet only, or one that is no Typst identifier
#names.at("Runs!Median")
```

*Computing* with a value:

```typ
#import "data/runs.ic.gen.typ": values

// values are strings: turn them into numbers first
#let median = float(values.Runs.at(4).at(4))
The 100-page document took #calc.round(median / 1000, digits: 2) s.
```
