// The spreadsheets extension: a spreadsheet file (`.ic`) shown and edited in IronCalc's workbook UI
// (SpreadsheetView, the custom editor `spreadsheets.editor`); every edit saves the file and the Typst file documents
// import. "New spreadsheet…" in the file panel's "New"; "Insert spreadsheet" in the Visual view's Insert menu.
// Entry of extensions/spreadsheets/. See docs/guide/features.typ.
// Why the extension stores the Typst file: documents import `name.ic.gen.typ`, never the workbook, so the Typst
// side needs no spreadsheet engine; the view only reports edits, the extension decides what the project gets.
import type { FileChange } from '../../core/project/project';
import { ProjectPath } from '../../core/paths/paths';
import type { ExtensionContext, TypstExtension } from '../../hosts/workbench/workbench';
import css from './spreadsheets.css?inline';
import { typstPath } from './model/typst-file';
import { insertSpreadsheet } from './visual-view/insert-spreadsheet';
import { SpreadsheetView } from './workbench/spreadsheet-view';
import type { WorkbookEdit } from './workbench/workbook';

/** The icon of spreadsheet files (where views list files). */
const SPREADSHEET_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M2 6h12M2 9.5h12M6 6v7.5M10 6v7.5"/></svg>';

/** The command behind "New spreadsheet…" (optional argument: the file or folder it goes next to / into). */
const NEW_SPREADSHEET = 'spreadsheets.newSpreadsheet';

/**
 * Spreadsheet files (`*.ic`) in the editing area: IronCalc's workbook UI; every edit is stored with its Typst file.
 * "New spreadsheet…" (`spreadsheets.newSpreadsheet`) in the menu `file/newFile` asks for a name and opens the new one;
 * "Insert spreadsheet" in the Visual view's Insert menu also puts its table into the text as a figure.
 */
export function spreadsheets(): TypstExtension {
  return {
    id: 'spreadsheets',
    activate(context) {
      const { commands, window, workbench, visualView, subscriptions } = context;
      subscriptions.push(
        workbench.registerStyleSheet(css),
        window.registerCustomEditorProvider(
          'spreadsheets.editor',
          {
            resolveCustomEditor(document, panel) {
              const view = new SpreadsheetView(panel.element, (path, edit) => save(context, path, edit));
              void view.show(document.path, document.content);
              panel.onDidDispose(() => view.dispose());
            },
          },
          { filenamePattern: '*.ic', displayName: 'Spreadsheet', icon: SPREADSHEET_ICON },
        ),
        commands.registerCommand(NEW_SPREADSHEET, (resource?: ProjectPath) => newSpreadsheet(context, resource)),
        workbench.registerMenuItem('file/newFile', { command: NEW_SPREADSHEET, title: 'New spreadsheet…', group: 'navigation', order: 15 }),
        visualView.registerToolbarItem(insertSpreadsheet(context, async (fileName) => (await import('./workbench/workbook')).newWorkbook(fileName))),
      );
    },
  };
}

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
