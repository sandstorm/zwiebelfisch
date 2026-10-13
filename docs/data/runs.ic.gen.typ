// Generated from runs.ic (next to this file) on every edit of the spreadsheet: edit runs.ic, not this file.
// #import "runs.ic.gen.typ": sheets, values, names, name-values
// #sheets.Sheet1                  the sheet as a table
// #values.Sheet1.at(1).at(0)      cell A2 as displayed (a string)
// #names.Total                    a named cell as displayed (a string)
// #names.Budget                   a named range as a table
// #name-values.Budget             a named range's displayed values, row by row
// #names.at("Sheet1!Total")       a name defined for one sheet only

#let values = (
  "Runs": (
    ("Pages", "Run 1", "Run 2", "Run 3", "Median"),
    ("1", "17", "18", "19", "18"),
    ("10", "92", "95", "99", "95"),
    ("50", "401", "410", "423", "410"),
    ("100", "806", "820", "851", "820"),
  ),
)

#let sheets = (
  "Runs": table(
    columns: (60pt, 60pt, 60pt, 60pt, 60pt),
    align: left + bottom,
    table.cell(fill: rgb("#e8eef7"), text(weight: "bold", "Pages")),
    table.cell(fill: rgb("#e8eef7"), text(weight: "bold", "Run 1")),
    table.cell(fill: rgb("#e8eef7"), text(weight: "bold", "Run 2")),
    table.cell(fill: rgb("#e8eef7"), text(weight: "bold", "Run 3")),
    table.cell(fill: rgb("#e8eef7"), text(weight: "bold", "Median")),
    table.cell(align: right + bottom, "1"),
    table.cell(align: right + bottom, "17"),
    table.cell(align: right + bottom, "18"),
    table.cell(align: right + bottom, "19"),
    table.cell(align: right + bottom, text(weight: "bold", "18")),
    table.cell(align: right + bottom, "10"),
    table.cell(align: right + bottom, "92"),
    table.cell(align: right + bottom, "95"),
    table.cell(align: right + bottom, "99"),
    table.cell(align: right + bottom, text(weight: "bold", "95")),
    table.cell(align: right + bottom, "50"),
    table.cell(align: right + bottom, "401"),
    table.cell(align: right + bottom, "410"),
    table.cell(align: right + bottom, "423"),
    table.cell(align: right + bottom, text(weight: "bold", "410")),
    table.cell(align: right + bottom, "100"),
    table.cell(align: right + bottom, "806"),
    table.cell(align: right + bottom, "820"),
    table.cell(align: right + bottom, "851"),
    table.cell(align: right + bottom, text(weight: "bold", "820")),
  ),
)

#let names = (:)

#let name-values = (:)
