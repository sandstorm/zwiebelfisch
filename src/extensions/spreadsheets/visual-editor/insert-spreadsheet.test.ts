// @vitest-environment jsdom
// Tests for insert-spreadsheet.ts in a Visual editor with the built-in constructs (testing/): the name asked, the files
// created, the figure and import inserted, the spreadsheet opened (the workbook itself faked: IronCalc needs a browser).
import { describe, expect, it, vi } from 'vitest';
import { ProjectPath } from '../../../core/paths/paths';
import { Project, type FileChange } from '../../../core/project/project';
import { SourceRange } from '../../../core/typst-document/typst-document';
import type { SaveDialogOptions } from '../../../hosts/window/window';
import { createVisualEditor } from '../../../testing/testing';
import { insertSpreadsheet, type InsertContext } from './insert-spreadsheet';

const path = ProjectPath.of;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const WORKBOOK = { bytes: new Uint8Array([1, 2]), typst: '#let sheets = (Sheet1: [])\n', sheet: 'Sheet1' };

/** `/main.typ` holding `text` in a Visual editor, the cursor at its end; the save dialog answers `answer`. */
function setup(text: string, answer: string | undefined, files: Record<string, string> = {}) {
  const project = new Project(path('/main.typ'), { '/main.typ': text, ...files });
  const document = project.document(path('/main.typ'))!;
  const asked: SaveDialogOptions[] = [];
  const opened: ProjectPath[] = [];
  const told: string[] = [];
  const context = {
    project,
    window: {
      showSaveDialog: async (options: SaveDialogOptions) => (asked.push(options), answer === undefined ? undefined : path(answer)),
      showErrorMessage: async (message: string) => void told.push(message),
    },
    workspace: { applyEdit: async (change: FileChange) => (project.apply(change), null) },
    workbench: { open: (target: ProjectPath) => void opened.push(target) },
  } as unknown as InsertContext;
  const newWorkbook = vi.fn(async () => WORKBOOK);
  const parent = window.document.body.appendChild(window.document.createElement('div'));
  const view = createVisualEditor(parent, document, {
    contributions: [{ id: 'test', activate: ({ visualEditor, subscriptions }) => subscriptions.push(visualEditor.registerToolbarItem(insertSpreadsheet(context, newWorkbook))) }],
  });
  view.reveal(SourceRange.of({ from: text.length - 1, to: text.length - 1 }));
  const click = async () => {
    parent.querySelector<HTMLButtonElement>('button[aria-label="Insert spreadsheet"]')!.click();
    await settle();
  };
  const undo = () => parent.querySelector<HTMLButtonElement>('button[aria-label="Undo"]')!.click();
  return { project, document, asked, opened, told, newWorkbook, click, undo };
}

describe('Insert spreadsheet', () => {
  it('proposes a free name next to the document, creates the spreadsheet and its Typst file, inserts the figure with its import (one undo step), opens it', async () => {
    const { project, document, asked, opened, newWorkbook, click, undo } = setup('= Results\n\nThe runs:\n', '/data/table-2.ic', { '/data/table.ic': '' });
    await click();
    expect(asked).toEqual([{ title: 'Insert spreadsheet', defaultUri: '/data/table-2.ic', filters: { Spreadsheets: ['ic'] } }]);
    expect(newWorkbook).toHaveBeenCalledWith('table-2.ic');
    expect(project.content(path('/data/table-2.ic'))).toEqual(WORKBOOK.bytes);
    expect(project.content(path('/data/table-2.ic.gen.typ'))).toBe(WORKBOOK.typst);
    expect(document.text).toBe('#import "data/table-2.ic.gen.typ": sheets\n\n= Results\n\nThe runs:\n\n#figure(sheets.Sheet1, caption: [ ])\n');
    expect(opened).toEqual(['/data/table-2.ic']);
    undo();
    expect(document.text).toBe('= Results\n\nThe runs:\n');
  });

  it('changes nothing when the name is not given', async () => {
    const { project, document, newWorkbook, click } = setup('Text\n', undefined);
    await click();
    expect(newWorkbook).not.toHaveBeenCalled();
    expect(project.paths()).toEqual(['/main.typ']);
    expect(document.text).toBe('Text\n');
  });
});
