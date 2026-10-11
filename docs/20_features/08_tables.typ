= Tables <features-tables>
#set heading(outlined: false)

== What it does

A Typst `#table`, edited cell by cell in the Visual editor:

```typ
#figure(
  table(
    columns: 3,
    table.header([*Pages*], [*Cold*], [*Incremental*]),
    [1], [18 ms], [4 ms],
    [100], [820 ms], [12 ms],
  ),
  caption: [Median compile times.],
) <tab:timings>
```

The Visual editor shows a grid with a header row and the caption below; the preview shows the table as Typst sets it.

- Insert → Insert table: a 2 × 2 `#table`.
- The bar over a table: Add row, Add column, Delete row, Delete column, Header row.
- Tab goes to the next cell; Tab in the last one adds a row.
- `columns` is a number or an array of column sizes (`(auto, 2fr, 1fr)`, any size per entry). Add column adds an entry: `1fr` if every column is a fraction, else `auto`; Delete column removes its entry.
- A table the Visual editor cannot edit as one stays a raw box (@features-full-typst-support): `columns` as a variable or computed (`cols`, `(..xs, 1fr)`), merged cells (`table.cell`), lines, a footer, comments between cells.
- Tables computed in a spreadsheet: @features-spreadsheets.

== How to configure

Nothing to configure.
