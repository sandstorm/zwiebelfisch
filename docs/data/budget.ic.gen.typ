// Generated from budget.ic (next to this file) on every edit of the spreadsheet: edit budget.ic, not this file.
// #import "budget.ic.gen.typ": sheets, values, names, name-values
// #sheets.Sheet1                  the sheet as a table
// #values.Sheet1.at(1).at(0)      cell A2 as displayed (a string)
// #names.Total                    a named cell as displayed (a string)
// #names.Budget                   a named range as a table
// #name-values.Budget             a named range's displayed values, row by row
// #names.at("Sheet1!Total")       a name defined for one sheet only

#let values = (
  "Budget": (
    ("Item", "Cost (€)"),
    ("Train tickets", "120"),
    ("Hotel, two nights", "180"),
    ("Museum pass", "35"),
    ("Total", "335"),
  ),
)

#let sheets = (
  "Budget": table(
    columns: (97.5pt, 60pt),
    align: left + bottom,
    table.cell(fill: rgb("#e8eef7"), text(weight: "bold", "Item")),
    table.cell(fill: rgb("#e8eef7"), text(weight: "bold", "Cost (€)")),
    "Train tickets",
    table.cell(align: right + bottom, "120"),
    "Hotel, two nights",
    table.cell(align: right + bottom, "180"),
    "Museum pass",
    table.cell(align: right + bottom, "35"),
    text(weight: "bold", "Total"),
    table.cell(align: right + bottom, text(weight: "bold", "335")),
  ),
)

#let names = (
  "Total": "335",
  "Budget": table(
    columns: (97.5pt, 60pt),
    align: left + bottom,
    table.cell(fill: rgb("#e8eef7"), text(weight: "bold", "Item")),
    table.cell(fill: rgb("#e8eef7"), text(weight: "bold", "Cost (€)")),
    "Train tickets",
    table.cell(align: right + bottom, "120"),
    "Hotel, two nights",
    table.cell(align: right + bottom, "180"),
    "Museum pass",
    table.cell(align: right + bottom, "35"),
    text(weight: "bold", "Total"),
    table.cell(align: right + bottom, text(weight: "bold", "335")),
  ),
)

#let name-values = (
  "Total": "335",
  "Budget": (
    ("Item", "Cost (€)"),
    ("Train tickets", "120"),
    ("Hotel, two nights", "180"),
    ("Museum pass", "35"),
    ("Total", "335"),
  ),
)
