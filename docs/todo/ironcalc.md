# Spreadsheets with IronCalc

Status: done (branch task/ironcalc) — Playwright spec written, needs a browser run
Depends on: nothing
Touches: src/core/project (binary updates, file kind), a new src/features/spreadsheets/, src/typst-editor.ts (opening files), src/features/files (icon), package.json (IronCalc, React), vite configs, ARCHITECTURE.md, docs/embedding.md

## Goal
Calculations live in spreadsheets inside the project; Typst shows their results. See
[docs/2026_10_10_spreadsheets.md](../2026_10_10_spreadsheets.md).

- A spreadsheet is a project file `name.ic`, in IronCalc's own format: the browser package
  `@ironcalc/wasm` has no `.xlsx` support (decided 2026-10-10; `.xlsx` import and export are a
  later trial).
- Opening it in the file panel shows IronCalc's own workbook UI (`@ironcalc/workbook`, React),
  loaded only when the first spreadsheet opens (decided 2026-10-10).
- Every edit is saved into the file and into `name.ic.gen.typ` (decided 2026-10-10, replacing
  `name.ic.json`): Typst imports `sheets` (each sheet as a `table` with the spreadsheet's column
  widths, row heights, alignment, fills, fonts and borders) and `values` (the displayed strings),
  both by sheet name: `#import "budget.ic.gen.typ": sheets, values`, `#sheets.Sheet1`,
  `#values.Sheet1.at(1).at(0)` (A2).
- "New file" `budget.ic` starts an empty workbook.

## Out of scope (MVP)
- `.xlsx` import and export (needs IronCalc's Rust `xlsx` code built to WebAssembly).
- Sharing spreadsheet edits in collaboration rooms (binary files: the last save wins).
- Referencing single cells or ranges from Typst beyond `values`.
- Merged cells (IronCalc 0.8.4 exposes no merges), conditional formatting, text overflowing into
  empty neighbour cells.
