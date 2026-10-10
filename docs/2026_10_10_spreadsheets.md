# Calculations and spreadsheets in the editor

Question (2026-10-10): is there a good open-source spreadsheet editor to embed for calculations,
or should calculations happen in Typst directly?

## Recommendation

**Calculate in Typst; give people a grid editor for the data, not a second calculation engine.**
Add a spreadsheet engine only when people need Excel-style formulas, and then use IronCalc.

1. **Data as project files, maths in Typst.** Numbers live in `.csv` / `.json` files (or `#let`
   data in a `.typ` file). Typst reads them (`csv()`, `json()`) and calculates in its scripting
   language: array methods like `.map`, `.sum`, `.fold` and `.sorted`, plus the `calc` module.
   Results go into `table(..)`, text and charts. One engine, one source of truth. The PDF always
   matches the data, the calculation is versioned with the text (GitLab diffs, "Changes since …"),
   and it works in the preview, the PDF export and collaboration without extra plumbing.
2. **A grid editor for data files.** Today a `.csv` opens as read-only text in the asset view.
   Make it an editable grid that holds values only, no formulas. It can reuse the Visual view's
   table editing, or use a small grid component. This covers most needs: change numbers and see
   the tables and sums in the preview update.
3. **Helpers for common calculations.** Ship a small Typst helper file (sum or average of a
   column, a total row, number formatting) so authors don't write `fold` by hand. Expression
   cells like `ms(18)` already show in Visual tables.
4. **Only if people need real spreadsheets** (what-if models, many cross-referencing formulas,
   imported `.xlsx` files), embed **IronCalc** for `.xlsx` files in the project:
   - Licence: MIT/Apache-2.0.
   - Implementation: a Rust engine that compiles to WebAssembly, the same stack as our Typst
     engine. It has more than 300 functions, reads and writes `.xlsx`, and its development is
     funded through 2026 (an EU grant; IronCalc GmbH, Berlin).
   - How it would fit: IronCalc evaluates the workbook, and the widget writes the computed
     ranges to a `.json`/`.csv` beside it, which Typst reads like any data file.
   - Spike idea: build IronCalc as a **Typst Wasm plugin**, so `#let wb = xlsx("model.xlsx")`
     calculates inside the Typst compile. That would need no generated file, but the plugin
     protocol (no I/O, bytes in and bytes out) and binary size need checking first.

## Candidates looked at

| | Licence | Fit |
|---|---|---|
| [IronCalc](https://github.com/ironcalc/IronCalc) | MIT / Apache-2.0 | Engine (Rust → Wasm) plus a web UI; `.xlsx`; actively developed. **Best fit** if we need formulas. |
| [Univer](https://github.com/dream-num/univer) | Apache-2.0 (core) | A full office SDK (canvas rendering, formula engine in a Web Worker); large; collaboration, import/export and charts are in the paid "Pro" edition. Too heavy to embed in a widget. |
| [HyperFormula](https://github.com/handsontable/hyperformula) | GPLv3 or commercial | A good headless formula engine, but GPLv3 does not suit an embeddable library; a commercial licence would be needed. |
| Handsontable | non-commercial / commercial | The same licence problem as HyperFormula. |
| x-spreadsheet, Jspreadsheet CE, Fortune-sheet | MIT | Lighter UIs. Formula support and maintenance vary, and they would bring a second calculation engine next to Typst. |

## Why not a spreadsheet as the primary tool

- Two engines (spreadsheet formulas and Typst) means two places where numbers are calculated. A
  formula result shown in the text then depends on generated files staying in sync.
- Spreadsheet files (`.xlsx`) are binary: they don't diff in GitLab, and our change tracking and
  collaboration (Yjs over text) don't reach inside them.
- Typst already has a complete scripting language. What is missing is an **editing UI for
  data**, not a calculation engine.
