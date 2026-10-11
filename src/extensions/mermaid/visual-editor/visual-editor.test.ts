// @vitest-environment jsdom
// Tests for visual-editor.ts in a Visual editor with the built-in constructs (testing/): "Insert Mermaid diagram" (the
// name asked, the file created, the figure and import inserted, the file opened).
import { describe, expect, it } from 'vitest';
import { ProjectPath } from '../../../core/paths/paths';
import { Project, type FileChange } from '../../../core/project/project';
import { SourceRange } from '../../../core/typst-document/typst-document';
import type { SaveDialogOptions } from '../../../hosts/window/window';
import { createVisualEditor } from '../../../testing/testing';
import { STARTER_FLOWCHART } from '../model/mermaid-figure';
import { insertMermaid, type InsertContext } from './visual-editor';

const path = ProjectPath.of;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** `/main.typ` holding `text` in a Visual editor, the cursor at its end; the save dialog answers `answer`. */
function setup(text: string, answer: string | undefined) {
  const project = new Project(path('/main.typ'), { '/main.typ': text });
  const document = project.document(path('/main.typ'))!;
  const asked: SaveDialogOptions[] = [];
  const opened: ProjectPath[] = [];
  const context = {
    project,
    window: { showSaveDialog: async (options: SaveDialogOptions) => (asked.push(options), answer === undefined ? undefined : path(answer)) },
    workspace: { applyEdit: async (change: FileChange) => (project.apply(change), null) },
    workbench: { open: (target: ProjectPath) => void opened.push(target) },
  } as unknown as InsertContext;
  const parent = window.document.body.appendChild(window.document.createElement('div'));
  const view = createVisualEditor(parent, document, {
    contributions: [
      {
        id: 'test',
        activate: ({ visualEditor, subscriptions }) =>
          subscriptions.push(visualEditor.registerToolbarItem(insertMermaid(context))),
      },
    ],
  });
  view.reveal(SourceRange.of({ from: text.length - 1, to: text.length - 1 }));
  const button = (label: string) => parent.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  const click = async () => {
    button('Insert Mermaid diagram')!.click();
    await settle();
  };
  return { project, document, asked, opened, parent, click };
}

describe('Insert Mermaid diagram', () => {
  it('creates a .mmd with a starter flowchart, inserts its figure with the import of merman, opens the file', async () => {
    const { project, document, asked, opened, click } = setup('= Method\n\nThe loop:\n', '/diagrams/diagram.mmd');
    await click();
    expect(asked).toEqual([{ title: 'Insert Mermaid diagram', defaultUri: '/diagrams/diagram.mmd', filters: { Mermaid: ['mmd'] } }]);
    expect(project.content(path('/diagrams/diagram.mmd'))).toBe(STARTER_FLOWCHART);
    expect(document.text).toBe(
      '#import "@preview/merman:0.4.0": mermaid\n\n= Method\n\nThe loop:\n\n#figure(mermaid(read("diagrams/diagram.mmd"), width: 100%), caption: [ ])\n',
    );
    expect(opened).toEqual(['/diagrams/diagram.mmd']);
  });

  it('changes nothing when the name is not given', async () => {
    const { project, document, click } = setup('Text\n', undefined);
    await click();
    expect(project.paths()).toEqual(['/main.typ']);
    expect(document.text).toBe('Text\n');
  });
});
