= Spreadsheets <features-spreadsheets>
#set heading(outlined: false)

#import "../template.typ": screenshot, example

#screenshot("spreadsheets")

An `.ic` file is *a spreadsheet you edit in #link("https://www.ironcalc.com")[IronCalc]*, supporting formulas, formats, and multiple sheets.

- Insert → Insert spreadsheet (or `/spreadsheet`): creates one with a starter table, inserts it as a figure and opens it.
- File panel → New → "New spreadsheet…" creates one without inserting it.
- Merged cells and `.xlsx` files are *not supported* right now.

Every edit writes `<name>.ic.gen.typ`, which you import in your Typst code. *Don't edit it.* It contains:

- `sheets`: each sheet as a `table` that looks like the spreadsheet (including column widths, fills, fonts, borders).
- `names` each named range as a `table` that looks like the spreadsheet
- `values`: the displayed cells as strings.
- `name-values`: the displayed cells of the named ranges as strings.

#example[
```typ
#import "data/runs.ic.gen.typ": sheets, values

#figure(sheets.Runs, caption: [Compile times.]) <tab:runs>

// row 5, column 5 (E5); counting starts at 0
The 100-page document took #values.Runs.at(4).at(4) ms.
```
]

== More examples

*A list* made from the rows:

#example[
```typ
#import "data/runs.ic.gen.typ": values

#for row in values.Runs.slice(1) [
  - #row.at(0) pages: #row.at(4) ms
]
```
]

*Named areas* (IronCalc's defined names):

#example[
```typ
#import "data/budget.ic.gen.typ": names

// a named cell: its displayed value
The trip costs #names.Total € in total.

// a named range: a table of just its cells, here smaller than the text width
#figure(
  scale(80%, reflow: true, names.Budget),
  caption: [The budget.],
)
```
]

A name defined *for one sheet only*, or one that is no Typst identifier: `names.at("Runs!Median")`.
