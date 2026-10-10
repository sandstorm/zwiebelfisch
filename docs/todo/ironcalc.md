# Spreadsheets with IronCalc

Status: in-progress (branch task/ironcalc)
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
- Every edit is saved into the file and into `name.ic.json`: per sheet, the rows of the cells'
  displayed values. Typst reads that with `json("name.ic.json")`.
- "New file" `budget.ic` starts an empty workbook.

## Out of scope (MVP)
- `.xlsx` import and export (needs IronCalc's Rust `xlsx` code built to WebAssembly).
- Sharing spreadsheet edits in collaboration rooms (binary files: the last save wins).
- Referencing single cells or ranges from Typst beyond the JSON file.
