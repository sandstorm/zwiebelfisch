// @vitest-environment jsdom
// Tests for insert-diagram.ts in a Visual view with the built-in constructs (testing/): the name asked, the empty
// diagram created, the figure inserted (a figure of an image, as the view reads it), the diagram editor opened.
import type { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { ProjectPath } from '../../../core/paths/paths';
import { Project, type FileChange } from '../../../core/project/project';
import { SourceRange } from '../../../core/typst-document/typst-document';
import type { SaveDialogOptions } from '../../../hosts/window/window';
import type { OpenOptions } from '../../../hosts/workbench/workbench';
import { createVisualView } from '../../../testing/testing';
import { emptyDiagram } from '../model/png';
import { insertDiagram, type InsertContext } from './insert-diagram';

const path = ProjectPath.of;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** `file` holding `text` in a view, the cursor at its end; the save dialog answers `answer`. */
function setup(file: string, text: string, answer: string | undefined) {
  const project = new Project(path('/main.typ'), { '/main.typ': '= Main\n', [file]: text, '/chapters/diagrams/diagram.drawio.png': emptyDiagram() });
  const document = project.document(path(file))!;
  const asked: SaveDialogOptions[] = [];
  const opened: [ProjectPath, OpenOptions | undefined][] = [];
  const context = {
    project,
    window: { showSaveDialog: async (options: SaveDialogOptions) => (asked.push(options), answer === undefined ? undefined : path(answer)) },
    workspace: { applyEdit: async (change: FileChange) => (project.apply(change), null) },
    workbench: { open: (target: ProjectPath, options?: OpenOptions) => void opened.push([target, options]) },
  } as unknown as InsertContext;
  const parent = window.document.body.appendChild(window.document.createElement('div'));
  const view = createVisualView(parent, document, {
    contributions: [{ id: 'test', activate: ({ visualView, subscriptions }) => subscriptions.push(visualView.registerToolbarItem(insertDiagram(context))) }],
  });
  view.reveal(SourceRange.of({ from: text.length - 1, to: text.length - 1 }));
  const editor = (parent.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor;
  const click = async () => {
    parent.querySelector<HTMLButtonElement>('button[aria-label="Insert diagram"]')!.click();
    await settle();
  };
  return { project, document, editor, asked, opened, click };
}

describe('Insert diagram', () => {
  it('proposes a free name next to the document, creates an empty diagram, inserts it as a figure and opens it in the diagram editor', async () => {
    const { project, document, editor, asked, opened, click } = setup('/chapters/method.typ', 'The loop:\n', '/chapters/diagrams/diagram-2.drawio.png');
    await click();
    expect(asked).toEqual([{ title: 'Insert diagram', defaultUri: '/chapters/diagrams/diagram-2.drawio.png', filters: { Diagrams: ['drawio.png'] } }]);
    expect(project.content(path('/chapters/diagrams/diagram-2.drawio.png'))).toEqual(emptyDiagram());
    expect(document.text).toBe('The loop:\n\n#figure(image("diagrams/diagram-2.drawio.png"), caption: [ ])\n');
    expect(editor.state.doc.lastChild!.type.name).toBe('figure');
    expect(opened).toEqual([['/chapters/diagrams/diagram-2.drawio.png', { viewType: 'diagrams.editor' }]]);
  });

  it('changes nothing when the name is not given', async () => {
    const { document, opened, click } = setup('/notes.typ', 'Text\n', undefined);
    await click();
    expect(document.text).toBe('Text\n');
    expect(opened).toEqual([]);
  });
});
