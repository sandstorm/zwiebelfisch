import type { FileChange, Project } from '../../core/project/project';
import { ProjectPath } from '../../core/paths/paths';
import { findFilePaths } from '../../core/typst-syntax/typst-syntax';
import type { DocumentDropEditProvider, DocumentLinkProvider } from '../../hosts/languages/languages';
import type { ExtensionContext, Extension } from '../../hosts/workbench/workbench';
import css from './spreadsheets.css?inline';
import { calculateSheetFigure, droppedSpreadsheet, firstSheet } from './model/sheet-figure';
import { spreadsheetPath, typstPath } from './model/typst-file';
import { registerInsertSpreadsheet } from './visual-editor/insert-spreadsheet';
import { SpreadsheetEditor } from './workbench/spreadsheet-editor';
import { SPREADSHEET_HELP } from './workbench/spreadsheet-help';
import type { WorkbookEdit } from './workbench/workbook';

/**
 * Spreadsheets (`.ic` files), edited in IronCalc's workbook UI and used in documents as Typst tables.
 *
 * - The custom editor `spreadsheets.editor` shows a spreadsheet. Every edit saves the file and writes
 *   `name.ic.gen.typ` next to it, the Typst file documents import, so Typst never needs a spreadsheet engine.
 * - "New spreadsheet…" (menu `file/newFile`) creates an empty one.
 * - "Insert spreadsheet" (Insert menu) creates one with a starter table and inserts it as a figure; so does a
 *   spreadsheet dropped from the file panel into the text.
 * - The path of a spreadsheet's Typst file in Typst text is the link "Edit spreadsheet", which opens the spreadsheet.
 * - `.ic` files are the language `ironcalc`, with the help sheet "Spreadsheet formulas".
 *
 * IronCalc (with React, a 2 MB engine) is loaded only when a spreadsheet is first shown or inserted.
 */
export function spreadsheets(): Extension {
  return {
    id: 'spreadsheets',
    contributes: {
      commands: [{ command: NEW_SPREADSHEET, title: 'New spreadsheet…', category: 'Spreadsheets' }],
      languages: [{ id: 'ironcalc', extensions: ['.ic'] }],
    },
    activate(context) {
      const { project, commands, window, workbench, languages, subscriptions } = context;
      subscriptions.push(
        workbench.registerStyleSheet(css),
        window.registerCustomEditorProvider(
          'spreadsheets.editor',
          {
            resolveCustomEditor(document, panel) {
              const editor = new SpreadsheetEditor(panel.element, (path, edit) => save(context, path, edit));
              void editor.show(document.path, document.content);
              panel.onDidDispose(() => editor.dispose());
            },
          },
          { filenamePattern: '*.ic', displayName: 'Spreadsheet', icon: SPREADSHEET_ICON },
        ),
        commands.registerCommand(NEW_SPREADSHEET, (resource?: ProjectPath) => newSpreadsheet(context, resource)),
        workbench.registerMenuItem('file/newFile', { command: NEW_SPREADSHEET, title: 'New spreadsheet…', group: 'navigation', order: 15 }),
        languages.registerHelpProvider({ language: 'ironcalc' }, { provideHelp: () => SPREADSHEET_HELP }),
        languages.registerDocumentLinkProvider({ language: 'typst' }, spreadsheetLinks(project), { priority: 110 }),
        languages.registerDocumentDropEditProvider({ language: 'typst' }, sheetDrops(project), { priority: 110 }),
        registerInsertSpreadsheet(context, async (fileName) => (await import('./workbench/workbook')).newWorkbook(fileName)),
      );
    },
  };
}

/**
 * The paths of spreadsheets' Typst files in Typst text as links "Edit spreadsheet" to the spreadsheet, when it is in the
 * project (else the path keeps its plain file link).
 */
function spreadsheetLinks(project: Pick<Project, 'has'>): DocumentLinkProvider {
  return {
    provideDocumentLinks: ({ path, text }) =>
      findFilePaths(text).flatMap(({ path: reference, from, to }) => {
        const resolved = ProjectPath.resolve(path, reference);
        const target = resolved && spreadsheetPath(resolved);
        return target && project.has(target) ? [{ range: { from, to }, target, tooltip: 'Edit spreadsheet' }] : [];
      }),
  };
}

/** The command behind "New spreadsheet…" (optional argument: the file or folder it goes next to / into). */
const NEW_SPREADSHEET = 'spreadsheets.newSpreadsheet';

/** Stores an edit of spreadsheet `path`: its bytes, and its Typst file next to it (`typstPath`); a refusal is an error message. */
function save({ project, window, workspace }: ExtensionContext, path: ProjectPath, { bytes, typst: content }: WorkbookEdit): void {
  const store = (change: FileChange) =>
    void workspace.applyEdit(change).then((problem) => problem && window.showErrorMessage(`${ProjectPath.displayName(change.path)} not saved: ${problem}`));
  store({ kind: 'update', path, content: bytes });
  const target = typstPath(path);
  if (project.content(target) === content) return;
  store(project.has(target) ? { kind: 'update', path: target, content } : { kind: 'create', path: target, content });
}

/**
 * A spreadsheet (`budget.ic`) or its Typst file dropped into a Typst file: the figure of its first sheet (as its Typst
 * file has it; none before that file exists) with the import it needs (`calculateSheetFigure`).
 */
function sheetDrops(project: Pick<Project, 'content'>): DocumentDropEditProvider {
  return {
    provideDocumentDropEdits({ path, text }, use, file) {
      const spreadsheet = droppedSpreadsheet(file);
      const typst = spreadsheet && project.content(typstPath(spreadsheet));
      const sheet = typeof typst === 'string' ? firstSheet(typst) : null;
      if (!spreadsheet || sheet === null) return null;
      const { source, importChange } = calculateSheetFigure(text, { file: path, spreadsheet, sheet, use });
      return { insertText: source, additionalEdit: importChange ? [importChange] : [] };
    },
  };
}

/** The icon of spreadsheet files (where side panels list files). */
const SPREADSHEET_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M2 6h12M2 9.5h12M6 6v7.5M10 6v7.5"/></svg>';

/**
 * Asks for a name (in the folder of `resource`: a file's, or the folder itself) ending in `.ic`
 * (`window.showSaveDialog`) and creates that empty spreadsheet (an empty workbook, saved by the editor on opening),
 * then opens it.
 */
async function newSpreadsheet({ window, workspace, workbench }: ExtensionContext, resource = window.activeFile): Promise<void> {
  const target = await window.showSaveDialog({ title: 'New spreadsheet', defaultUri: resource, filters: { Spreadsheets: ['ic'] } });
  if (!target) return;
  const problem = await workspace.applyEdit({ kind: 'create', path: target, content: new Uint8Array() });
  if (problem) void window.showErrorMessage(`${ProjectPath.displayName(target)} not created: ${problem}`);
  else workbench.open(target);
}
