// The spreadsheets extension: a spreadsheet file (`.ic`) shown and edited in IronCalc's workbook UI
// (SpreadsheetView, the custom editor `spreadsheets.editor`); every edit saves the file and the Typst file documents
// import. "New spreadsheet…" in the file panel's "New". Entry of extensions/spreadsheets/. See ARCHITECTURE.md,
// "Spreadsheets".
// Why the extension stores the Typst file: documents import `name.ic.gen.typ`, never the workbook, so the Typst
// side needs no spreadsheet engine; the view only reports edits, the extension decides what the project gets.
import type { FileChange } from '../../core/project/project';
import { ProjectPath } from '../../core/paths/paths';
import type { ExtensionContext, TypstExtension } from '../../hosts/workbench/workbench';
import css from './spreadsheets.css?inline';
import { typstPath } from './model/typst-file';
import { SpreadsheetView } from './workbench/spreadsheet-view';
import type { WorkbookEdit } from './workbench/workbook';

/** The command behind "New spreadsheet…" (optional argument: the file or folder it goes next to / into). */
const NEW_SPREADSHEET = 'spreadsheets.newSpreadsheet';

/**
 * Spreadsheet files (`*.ic`) in the editing area: IronCalc's workbook UI; every edit is stored with its Typst file.
 * "New spreadsheet…" (`spreadsheets.newSpreadsheet`) in the menu `file/newFile` asks for a name and opens the new one.
 */
export function spreadsheets(): TypstExtension {
  return {
    id: 'spreadsheets',
    activate(context) {
      const { commands, window, workbench, subscriptions } = context;
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
          { filenamePattern: '*.ic' },
        ),
        commands.registerCommand(NEW_SPREADSHEET, (resource?: ProjectPath) => newSpreadsheet(context, resource)),
        workbench.registerMenuItem('file/newFile', { command: NEW_SPREADSHEET, title: 'New spreadsheet…', group: 'navigation', order: 15 }),
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
 * Asks for a name (in the folder of `resource`: a file's, or the folder itself) and creates that empty spreadsheet
 * (an empty workbook, saved by the editor on opening), then opens it.
 */
async function newSpreadsheet({ project, window, workspace, workbench }: ExtensionContext, resource = workbench.activeFile): Promise<void> {
  const folder = project.has(resource) ? resource.slice(0, resource.lastIndexOf('/')) : resource;
  const value = folder === '' ? '' : `${folder.slice(1)}/`;
  const pathOf = (name: string) => ProjectPath.fromName(name, '.ic');
  const name = await window.showInputBox({
    title: 'New spreadsheet',
    prompt: 'Name of the new spreadsheet',
    value,
    valueSelection: [value.length, value.length],
    placeHolder: 'e.g. budget',
    validateInput: (typed) => {
      const target = pathOf(typed);
      if (target.kind === 'invalid') return target.error;
      if (!target.path.endsWith('.ic')) return 'A spreadsheet’s name ends in .ic.';
      return project.has(target.path) ? `${ProjectPath.displayName(target.path)} already exists.` : null;
    },
  });
  const target = name === undefined ? null : pathOf(name);
  if (!target || target.kind === 'invalid') return;
  const problem = await workspace.applyEdit({ kind: 'create', path: target.path, content: new Uint8Array() });
  if (problem) void window.showErrorMessage(`${ProjectPath.displayName(target.path)} not created: ${problem}`);
  else workbench.open(target.path);
}
