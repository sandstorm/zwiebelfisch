// "Insert diagram" in the Visual editor's Insert menu (and so among the slash commands). See diagrams in ../diagrams.ts.
import { PathReference, ProjectPath } from '../../../core/paths/paths';
import { Disposable } from '../../../core/disposable/disposable';
import { insertTypst, svg, type VisualEditorMenuContext } from '../../../hosts/visual-editor/visual-editor';
import type { ExtensionContext } from '../../../hosts/extension-host/extension-host';
import { DIAGRAM_EDITOR, diagramFigure } from '../model/model';
import { createDiagram } from '../workbench/new-diagram';

/**
 * "Insert diagram": asks for the new diagram's name (proposing a free `diagrams/diagram.drawio.png` next to the
 * document), creates the empty diagram (as "New diagram…"), inserts `#figure(image("…"), caption: [ ])` after the
 * cursor's block and opens the diagram in the diagram editor, where it is drawn.
 */
export function registerInsertDiagram(context: InsertContext): Disposable {
  return Disposable.from(
    context.commands.registerCommand(INSERT_DIAGRAM, (menu: VisualEditorMenuContext) => insert(context, menu)),
    context.window.registerMenuItem('visualEditor/insert', {
      command: INSERT_DIAGRAM,
      title: 'Insert diagram',
      icon: ICON,
      keywords: ['drawio', 'draw.io', 'diagrams.net', 'drawing', 'chart', 'figure'],
      order: 12,
    }),
  );
}

/** What inserting a diagram uses of the extension context. */
export type InsertContext = Pick<ExtensionContext, 'project' | 'window' | 'workspace' | 'window' | 'commands'>;

/** "Insert diagram" (the command's argument: the Visual editor menu context). */
const INSERT_DIAGRAM = 'diagrams.insertDiagram';

const ICON = svg('<rect x="3" y="3" width="7" height="6" rx="1"/><rect x="14" y="15" width="7" height="6" rx="1"/><path d="M6.5 9v9H14"/>');

async function insert(context: InsertContext, { tiptap, document }: VisualEditorMenuContext): Promise<void> {
  const { project, window } = context;
  const file = project.pathOf(document);
  const proposed = file && ProjectPath.resolve(file, PROPOSED);
  if (!proposed) return;
  const target = await createDiagram(context, 'Insert diagram', ProjectPath.unique(proposed, (path) => project.has(path)));
  // the document may have moved meanwhile
  const at = project.pathOf(document);
  if (!target || !at) {
    tiptap.commands.focus();
    return;
  }
  insertTypst(tiptap, diagramFigure(ProjectPath.referenceTo(at, target)));
  window.showDocument(target, { viewType: DIAGRAM_EDITOR });
}

/** Where a new diagram is proposed, relative to the document. */
const PROPOSED = PathReference.of('diagrams/diagram.drawio.png');
