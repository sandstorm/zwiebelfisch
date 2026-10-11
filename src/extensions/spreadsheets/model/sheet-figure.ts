// A spreadsheet in a document as a figure: the starter table, the name its sheets go by in the document (a second
// spreadsheet's get one of their own), the import that binds it and the figure's Typst. See spreadsheets in
// ../spreadsheets.ts.
import { PathReference, ProjectPath } from '../../../core/paths/paths';
import type { SourceOffset, TextChange } from '../../../core/typst-document/typst-document';
import { calculateImportChange, importedNames, quote } from '../../../core/typst-syntax/typst-syntax';
import { typstPath } from './typst-file';

/**
 * The figure of a sheet in a document, and the change that imports what it names (null: imported already).
 */
export interface SheetFigure {
  /** `#figure(sheets.Sheet1, caption: [ ])`. */
  readonly source: string;
  readonly importChange: TextChange | null;
}

/** What "Insert spreadsheet" types into the new spreadsheet's first sheet: a bold header row and two rows. */
export const STARTER_TABLE: readonly (readonly string[])[] = [
  ['Item', 'Value'],
  ['First', '1'],
  ['Second', '2'],
];

/** The part of IronCalc's `Model` typing the starter table needs. */
export interface CellInput {
  setUserInput(sheet: number, row: number, column: number, input: string): void;
  updateRangeStyle(range: { sheet: number; row: number; column: number; width: number; height: number }, path: string, value: string): void;
  evaluate(): void;
}

/** Types `STARTER_TABLE` into the first sheet of `model` from A1, its first row bold. */
export function typeStarterTable(model: CellInput): void {
  STARTER_TABLE.forEach((cells, row) => cells.forEach((input, column) => model.setUserInput(0, row + 1, column + 1, input)));
  model.updateRangeStyle({ sheet: 0, row: 1, column: 1, width: STARTER_TABLE[0].length, height: 1 }, 'font.b', 'true');
  model.evaluate();
}

/** Which sheet goes where: sheet `sheet` of `spreadsheet`, at `use` in the document `file`. */
export interface SheetPlace {
  readonly file: ProjectPath;
  readonly spreadsheet: ProjectPath;
  readonly sheet: string;
  readonly use: SourceOffset;
}

/**
 * The figure of a sheet in Typst `text` (the document's, see `SheetPlace`) and the import it needs. The tables come from the spreadsheet's Typst file (`typstPath`) as `sheets`; an import of that file before
 * `use` is used as it is (`sheets`, `sheets as x`, `*`). When `sheets` names another module's tables already, this
 * one's are imported as `<name>-sheets` (`budget-sheets` for `budget.ic`; numbered when taken).
 */
export function calculateSheetFigure(text: string, { file, spreadsheet, sheet, use }: SheetPlace): SheetFigure {
  const module = typstPath(spreadsheet);
  const isModule = (written: string) => ProjectPath.resolve(file, PathReference.of(written)) === module;
  const imported = importedNames(text, use);
  const existing = imported.find((name) => isModule(name.module) && (name.name === SHEETS || name.name === '*'));
  const binding = existing ? (existing.binding === '*' ? SHEETS : existing.binding) : freeBinding(imported, spreadsheet);
  const item = binding === SHEETS ? SHEETS : `${SHEETS} as ${binding}`;
  const importChange = existing
    ? null
    : calculateImportChange(text, {
        name: item,
        matches: isModule,
        // a blank line after it, unless more imports follow: an import right above a block would make the two one (raw) block
        create: () => `#import ${quote(ProjectPath.referenceTo(file, module))}: ${item}\n${/^\s*(\n|#import\b)/.test(text) ? '' : '\n'}`,
        use,
      });
  return { source: `#figure(${binding}${field(sheet)}, caption: [ ])`, importChange };
}

/** The name the generated file's tables are imported by (`sheets`, see `spreadsheetTypst`). */
const SHEETS = 'sheets';

/** `sheets` if nothing else is bound to it (another spreadsheet's file imported with `*` binds it too), else `<name>-sheets`. */
function freeBinding(imported: readonly { module: string; binding: string }[], spreadsheet: ProjectPath): string {
  const taken = new Set(imported.map((name) => name.binding));
  if (imported.some((name) => name.binding === '*' && name.module.endsWith('.ic.gen.typ'))) taken.add(SHEETS);
  if (!taken.has(SHEETS)) return SHEETS;
  const stem = ProjectPath.name(spreadsheet).replace(/\.ic$/i, '').replace(/[^\p{L}\p{N}_-]+/gu, '-');
  const base = `${/^[\p{L}_]/u.test(stem) ? stem : `sheet-${stem}`}-${SHEETS}`;
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** How a sheet is reached in the dictionary: `.Sheet1`, or `.at("Q1 2026")` for a name that is no identifier. */
function field(sheet: string): string {
  return /^[\p{L}_][\p{L}\p{N}_-]*$/u.test(sheet) ? `.${sheet}` : `.at(${quote(sheet)})`;
}
