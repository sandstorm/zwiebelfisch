// @vitest-environment jsdom
// Tests for visual-view.ts in a Visual view with the built-in constructs (testing/): "Insert Mermaid diagram" (the
// name asked, the file created, the figure and import inserted, the file opened) and "Edit diagram" on its box.
import { describe, expect, it } from 'vitest';
import { ProjectPath } from '../../../core/paths/paths';
import { Project, type FileChange } from '../../../core/project/project';
import { SourceRange } from '../../../core/typst-document/typst-document';
import type { SaveDialogOptions } from '../../../hosts/window/window';
import { createVisualView } from '../../../testing/testing';
import { STARTER_FLOWCHART } from '../model/mermaid-figure';
import { editMermaidAction, insertMermaid, type InsertContext } from './visual-view';

const path = ProjectPath.of;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** `/main.typ` holding `text` in a view, the cursor at its end; the save dialog answers `answer`. */
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
  // the box's file: any `.mmd` its Typst names (the extension asks the document links)
  const mermaidOf = (src: string) => {
    const read = /read\("(.+\.mmd)"\)/.exec(src);
    return read ? path(`/${read[1]}`) : null;
  };
  const parent = window.document.body.appendChild(window.document.createElement('div'));
  const view = createVisualView(parent, document, {
    contributions: [
      {
        id: 'test',
        activate: ({ visualView, subscriptions }) =>
          subscriptions.push(visualView.registerToolbarItem(insertMermaid(context)), visualView.registerRawBoxAction(editMermaidAction(mermaidOf, (target) => opened.push(target)))),
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

  it('puts "Edit diagram" on a box reading a .mmd file, opening it', () => {
    const { parent, opened } = setup('Text\n\n#figure(mermaid(read("loop.mmd")), caption: [Loop])\n\n#box[other]\n', undefined);
    const edit = [...parent.querySelectorAll<HTMLButtonElement>('button')].filter((b) => b.textContent === 'Edit diagram');
    expect(edit).toHaveLength(1);
    edit[0].click();
    expect(opened).toEqual(['/loop.mmd']);
  });
});
