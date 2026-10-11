// SpreadsheetView: a spreadsheet file in the editing area — its title and IronCalc's workbook UI, loaded on demand
// (workbook.ts). See ../spreadsheets.ts.
import type { FileContent } from '../../../core/project/project';
import { ProjectPath } from '../../../core/paths/paths';
import type { MountedWorkbook, WorkbookEdit } from './workbook';

/**
 * The editing area of a spreadsheet: a title and IronCalc's workbook UI,
 * loaded (with React and the engine) the first time a spreadsheet is shown.
 * Edits go to `onEdit` with the path, the new bytes and the spreadsheet's
 * Typst file (tables and values, see `spreadsheetTypst`); the host stores
 * both (the Typst file at `typstPath`).
 */
export class SpreadsheetView {
  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly body: HTMLElement;
  private mounted: MountedWorkbook | null = null;
  /** Bumped by every show and by dispose: a slow load that was overtaken is dropped. */
  private generation = 0;

  constructor(
    parent: HTMLElement,
    private readonly onEdit: (path: ProjectPath, edit: WorkbookEdit) => void,
  ) {
    const doc = parent.ownerDocument;
    this.root = doc.createElement('div');
    this.root.className = 'typst-sheet';
    this.root.dataset.testid = 'typst-spreadsheet';
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
    this.body.textContent = 'Loading spreadsheet…';
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    try {
      const { mountWorkbook } = await import('./workbook');
      if (generation !== this.generation) return;
      this.body.textContent = '';
      const fileName = path.slice(path.lastIndexOf('/') + 1);
      const mounted = await mountWorkbook(this.body, bytes, fileName, (edit) => this.onEdit(path, edit));
      if (generation === this.generation) this.mounted = mounted;
      else mounted.dispose();
    } catch (error) {
      if (generation === this.generation) this.body.textContent = `This spreadsheet cannot be opened: ${String(error)}`;
    }
  }

  dispose(): void {
    this.unmount();
    this.root.remove();
  }

  private unmount(): number {
    this.mounted?.dispose();
    this.mounted = null;
    return ++this.generation;
  }
}
