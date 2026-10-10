// The spreadsheets extension: a spreadsheet file (`.ic`) shown and edited in IronCalc's workbook UI
// (SpreadsheetView); every edit saves the file and the Typst file documents import. Entry of features/spreadsheets/.
// See ARCHITECTURE.md, "Spreadsheets".
import { type FileContent, type Project } from '../../core/project/project';
import { ProjectPath } from '../../core/paths/paths';
import type { TypstExtension, Workbench } from '../../hosts/workbench/workbench';
import { typstPath } from './typst-file';
import type { MountedWorkbook, WorkbookEdit } from './workbook';

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

/**
 * The editing area of a spreadsheet: a title and IronCalc's workbook UI,
 * loaded (with React and the engine) the first time a spreadsheet is shown.
 * Edits go to `onEdit` with the path, the new bytes and the spreadsheet's
 * Typst file (tables and values, see `spreadsheetTypst`); the host stores
 * both (the Typst file at `typstPath`).
 */
class SpreadsheetView {
  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly body: HTMLElement;
  private mounted: MountedWorkbook | null = null;
  /** Bumped by every show / hide: a slow load that was overtaken is dropped. */
  private generation = 0;

  constructor(
    parent: HTMLElement,
    private readonly onEdit: (path: ProjectPath, edit: WorkbookEdit) => void,
  ) {
    const doc = parent.ownerDocument;
    this.root = doc.createElement('div');
    this.root.className = 'typst-sheet';
    this.root.dataset.testid = 'typst-spreadsheet';
    this.root.hidden = true;
    this.title = doc.createElement('h2');
    this.title.className = 'typst-sheet__title';
    this.body = doc.createElement('div');
    this.body.className = 'typst-sheet__body';
    this.root.append(this.title, this.body);
    parent.append(this.root);
  }

  /** Shows spreadsheet `path` with `content` (its bytes; empty: a new workbook). */
  async show(path: ProjectPath, content: FileContent): Promise<void> {
    const generation = this.unmount();
    this.title.textContent = ProjectPath.displayName(path);
    this.root.hidden = false;
    this.body.textContent = 'Loading spreadsheet…';
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    try {
      const { mountWorkbook } = await import('./workbook');
      if (generation !== this.generation) return;
      this.body.textContent = '';
      const fileName = path.slice(path.lastIndexOf('/') + 1);
      const mounted = await mountWorkbook(this.body, bytes, fileName, (edit) => this.onEdit(path, edit));
      if (generation === this.generation) this.mounted = mounted;
      else mounted.destroy();
    } catch (error) {
      if (generation === this.generation) this.body.textContent = `This spreadsheet cannot be opened: ${String(error)}`;
    }
  }

  hide(): void {
    this.unmount();
    this.root.hidden = true;
  }

  destroy(): void {
    this.unmount();
    this.root.remove();
  }

  private unmount(): number {
    this.mounted?.destroy();
    this.mounted = null;
    return ++this.generation;
  }
}
