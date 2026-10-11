// "Insert spreadsheet" in the Visual editor's Insert menu (and so among the slash commands): a new spreadsheet with a
// starter table, its table as a figure in the text, then the spreadsheet opened. See ../spreadsheets.ts.
import type { FileChange } from '../../../core/project/project';
import { PathReference, ProjectPath } from '../../../core/paths/paths';
import { insertTypstBlocks, svg, type ToolbarContext, type ToolbarItem } from '../../../hosts/visual-editor/visual-editor';
import type { ExtensionContext } from '../../../hosts/workbench/workbench';
import { calculateSheetFigure } from '../model/sheet-figure';
import { typstPath } from '../model/typst-file';
import type { NewWorkbook } from '../workbench/workbook';

/** What inserting a spreadsheet uses of the extension context. */
export type InsertContext = Pick<ExtensionContext, 'project' | 'window' | 'workspace' | 'workbench'>;

/** Where a new spreadsheet is proposed, relative to the document. */
const PROPOSED = PathReference.of('data/table.ic');
/** The origin of the import change (the document's listeners see who changed it). */
const INSERT_SPREADSHEET = 'spreadsheets.insertSpreadsheet';
const ICON = svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14.5h18M9 9v11M15 9v11"/>');

/**
 * "Insert spreadsheet": asks for the new spreadsheet's name (`window.showSaveDialog`, proposing a free
 * `data/table.ic` next to the document), creates it with the starter table and its Typst file (both through
 * `workspace.applyEdit`, so the document compiles at once), inserts `#figure(sheets.Sheet1, caption: [ ])` after the
 * cursor's block with the import it needs (`calculateSheetFigure`), and opens the spreadsheet: the starter values
 * are placeholders, so filling them in is next. `newWorkbook` makes the spreadsheet (IronCalc, loaded on demand).
 */
export function insertSpreadsheet(context: InsertContext, newWorkbook: (fileName: string) => Promise<NewWorkbook>): ToolbarItem {
  return {
    group: 'insert',
    order: 25,
    create: (toolbar) => ({
      label: 'Insert spreadsheet',
      icon: ICON,
      keywords: ['spreadsheet', 'sheet', 'ironcalc', 'excel', 'calc', 'data', 'figure'],
      click: () => void insert(context, toolbar, newWorkbook),
    }),
  };
}

async function insert({ project, window, workspace, workbench }: InsertContext, toolbar: ToolbarContext, newWorkbook: (fileName: string) => Promise<NewWorkbook>): Promise<void> {
  const { editor, document } = toolbar;
  const file = project.pathOf(document);
  const proposed = file && ProjectPath.resolve(file, PROPOSED);
  if (!proposed) return;
  const target = await window.showSaveDialog({ title: 'Insert spreadsheet', defaultUri: ProjectPath.unique(proposed, (path) => project.has(path)), filters: { Spreadsheets: ['ic'] } });
  if (!target) {
    editor.commands.focus();
    return;
  }
  const workbook = await newWorkbook(ProjectPath.name(target));
  const generated = typstPath(target);
  const changes: FileChange[] = [
    { kind: 'create', path: target, content: workbook.bytes },
    project.has(generated) ? { kind: 'update', path: generated, content: workbook.typst } : { kind: 'create', path: generated, content: workbook.typst },
  ];
  for (const change of changes) {
    const problem = await workspace.applyEdit(change);
    if (problem) {
      void window.showErrorMessage(`${ProjectPath.displayName(change.path)} not created: ${problem}`);
      return;
    }
  }
  // the document may have moved meanwhile
  const at = project.pathOf(document);
  if (!at) return;
  const { source, importChange } = calculateSheetFigure(document.text, { file: at, spreadsheet: target, sheet: workbook.sheet, use: toolbar.selection().from });
  if (importChange) document.change([importChange], INSERT_SPREADSHEET);
  insertTypstBlocks(editor, source);
  workbench.open(target);
}
