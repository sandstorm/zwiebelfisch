// "Insert spreadsheet" in the Visual editor's Insert menu (and so among the slash commands). See spreadsheets in ../spreadsheets.ts.
import type { FileChange } from '../../../core/project/project';
import { PathReference, ProjectPath } from '../../../core/paths/paths';
import { Disposable } from '../../../core/disposable/disposable';
import { insertTypst, svg, type VisualEditorMenuContext } from '../../../hosts/visual-editor/visual-editor';
import type { ExtensionContext } from '../../../hosts/extension-host/extension-host';
import { calculateSheetFigure } from '../model/sheet-figure';
import { typstPath } from '../model/typst-file';
import type { NewWorkbook } from '../workbench/workbook';

/**
 * "Insert spreadsheet" in the Insert menu: asks for the new spreadsheet's name (proposing a free `data/table.ic` next
 * to the document), creates it with the starter table and its Typst file, so the document compiles at once, inserts
 * `#figure(sheets.Sheet1, caption: [ ])` after the cursor's block with the import it needs (one undo step), and opens
 * the spreadsheet. `newWorkbook` makes the spreadsheet.
 */
export function registerInsertSpreadsheet(context: InsertContext, newWorkbook: (fileName: string) => Promise<NewWorkbook>): Disposable {
  return Disposable.from(
    context.commands.registerCommand(INSERT_SPREADSHEET, (menu: VisualEditorMenuContext) => insert(context, menu, newWorkbook)),
    context.window.registerMenuItem('visualEditor/insert', {
      command: INSERT_SPREADSHEET,
      title: 'Insert spreadsheet',
      icon: ICON,
      keywords: ['spreadsheet', 'sheet', 'ironcalc', 'excel', 'calc', 'data', 'figure'],
      order: 25,
    }),
  );
}

/** What inserting a spreadsheet uses of the extension context. */
export type InsertContext = Pick<ExtensionContext, 'project' | 'window' | 'workspace' | 'window' | 'commands'>;

/** "Insert spreadsheet" (the command's argument: the Visual editor menu context). */
const INSERT_SPREADSHEET = 'spreadsheets.insertSpreadsheet';

const ICON = svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14.5h18M9 9v11M15 9v11"/>');

async function insert({ project, window, workspace }: InsertContext, menu: VisualEditorMenuContext, newWorkbook: (fileName: string) => Promise<NewWorkbook>): Promise<void> {
  const { tiptap, document } = menu;
  const file = project.pathOf(document);
  const proposed = file && ProjectPath.resolve(file, PROPOSED);
  if (!proposed) return;
  const target = await window.showSaveDialog({ title: 'Insert spreadsheet', defaultUri: ProjectPath.unique(proposed, (path) => project.has(path)), filters: { Spreadsheets: ['ic'] } });
  if (!target) {
    tiptap.commands.focus();
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
  const { source, importChange } = calculateSheetFigure(document.text, { file: at, spreadsheet: target, sheet: workbook.sheet, use: menu.selection().from });
  insertTypst(tiptap, source, undefined, importChange ? [importChange] : []);
  window.showDocument(target);
}

/** Where a new spreadsheet is proposed, relative to the document. */
const PROPOSED = PathReference.of('data/table.ic');
