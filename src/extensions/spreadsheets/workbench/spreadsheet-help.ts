// The help sheet of spreadsheets. See spreadsheets in ../spreadsheets.ts.
import type { HelpSheet } from '../../../hosts/languages/languages';

/**
 * "Spreadsheet formulas": what to type into IronCalc's cells, and how a spreadsheet reaches a Typst document (its
 * Typst file, `name.ic.gen.typ`: `sheets`, `values`).
 */
export const SPREADSHEET_HELP: HelpSheet = {
  title: 'Spreadsheet formulas',
  sections: [
    {
      title: 'Formulas',
      rows: [
        { snippet: '=A1+B1', description: 'A formula starts with =; cells by column and row' },
        { snippet: '=A1*(1+B1)', description: 'Arithmetic: + - * / ^ and parentheses' },
        { snippet: '=SUM(A1:A10)', description: 'A range: from one cell to another' },
        { snippet: '=AVERAGE(B2:B20)', description: 'The mean of a range' },
        { snippet: '=IF(A1>100, "high", "low")', description: 'A value by condition' },
        { snippet: '=A1&" "&B1', description: 'Joins texts' },
      ],
    },
    {
      title: 'References',
      rows: [
        { snippet: '=$A$1*B2', description: 'Absolute: $A$1 stays A1 when the formula is copied ($A1, A$1: one part)' },
        { snippet: '=Sheet2!A1', description: 'A cell of another sheet' },
        { snippet: "='Q1 2026'!B3", description: 'A sheet whose name has spaces, in quotes' },
        { snippet: '=SUM(Sheet2!A1:A10)', description: 'A range of another sheet' },
      ],
    },
    {
      title: 'In the document',
      rows: [
        { snippet: '#import "table.ic.gen.typ": sheets, values', description: 'Every spreadsheet has a Typst file next to it, updated on every edit' },
        { snippet: '#figure(sheets.Sheet1, caption: [A table])', description: 'A sheet as a table: values, alignment, fills, fonts, borders' },
        { snippet: '#values.Sheet1.at(1).at(0)', description: 'Cell A2 as displayed (a string): rows, then columns, from 0' },
        { snippet: '#sheets.at("Q1 2026")', description: 'A sheet whose name is no identifier' },
      ],
    },
  ],
  links: [{ label: 'IronCalc documentation', href: 'https://docs.ironcalc.com/' }],
};
