// The spreadsheets extension: a spreadsheet file (`.ic`) shown and edited in IronCalc's workbook UI
// (SpreadsheetView); every edit saves the file and the Typst file documents import. Entry of extensions/spreadsheets/.
// See ARCHITECTURE.md, "Spreadsheets".
// Why the extension stores the Typst file: documents import `name.ic.gen.typ`, never the workbook, so the Typst
// side needs no spreadsheet engine; the view only reports edits, the extension decides what the project gets.
import type { Project } from '../../core/project/project';
import type { ProjectPath } from '../../core/paths/paths';
import type { TypstExtension, Workbench } from '../../hosts/workbench/workbench';
import { typstPath } from './model/model';
import { SpreadsheetView, type WorkbookEdit } from './workbench/workbench';

/** Spreadsheet files in the editing area: IronCalc's workbook UI; every edit is stored with its Typst file. */
export function spreadsheets(): TypstExtension {
  return {
    id: 'spreadsheets',
    activate({ project, workbench, subscriptions }) {
      subscriptions.push(
        workbench.registerFileView('spreadsheet', {
          createFileView: (parent) => {
            const view = new SpreadsheetView(parent, (path, edit) => save(project, workbench, path, edit));
            return { show: (path, content) => void view.show(path, content), hide: () => view.hide(), dispose: () => view.destroy() };
          },
        }),
      );
    },
  };
}

/** Stores an edit of spreadsheet `path`: its bytes, and its Typst file next to it (`typstPath`). */
function save(project: Project, workbench: Workbench, path: ProjectPath, { bytes, typst: content }: WorkbookEdit): void {
  void workbench.applyChange({ kind: 'update', path, content: bytes });
  const target = typstPath(path);
  if (project.content(target) === content) return;
  void workbench.applyChange(project.has(target) ? { kind: 'update', path: target, content } : { kind: 'create', path: target, content });
}
