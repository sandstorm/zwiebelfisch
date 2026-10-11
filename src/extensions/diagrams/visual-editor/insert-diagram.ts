// "Insert diagram" in the Visual editor's Insert menu (and so among the slash commands): a new `.drawio.png` as a
// figure in the text, then opened in the diagram editor. See ../diagrams.ts.
import { PathReference, ProjectPath } from '../../../core/paths/paths';
import { quote } from '../../../core/typst-syntax/typst-syntax';
import { insertTypstBlocks, svg, type ToolbarContext, type ToolbarItem } from '../../../hosts/visual-editor/visual-editor';
import type { ExtensionContext } from '../../../hosts/workbench/workbench';
import { DIAGRAM_EDITOR } from '../model/model';
import { createDiagram } from '../workbench/new-diagram';

/** What inserting a diagram uses of the extension context. */
export type InsertContext = Pick<ExtensionContext, 'project' | 'window' | 'workspace' | 'workbench'>;

/** Where a new diagram is proposed, relative to the document. */
const PROPOSED = PathReference.of('diagrams/diagram.drawio.png');
const ICON = svg('<rect x="3" y="3" width="7" height="6" rx="1"/><rect x="14" y="15" width="7" height="6" rx="1"/><path d="M6.5 9v9H14"/>');

/**
 * "Insert diagram": asks for the new diagram's name (proposing a free `diagrams/diagram.drawio.png` next to the
 * document), creates the empty diagram (as "New diagram…"), inserts `#figure(image("…"), caption: [ ])` after the
 * cursor's block and opens the diagram in the diagram editor, where it is drawn.
 */
export function insertDiagram(context: InsertContext): ToolbarItem {
  return {
    group: 'insert',
    order: 12,
    create: (toolbar) => ({
      label: 'Insert diagram',
      icon: ICON,
      keywords: ['drawio', 'draw.io', 'diagrams.net', 'drawing', 'chart', 'figure'],
      click: () => void insert(context, toolbar),
    }),
  };
}

async function insert(context: InsertContext, { editor, document }: ToolbarContext): Promise<void> {
  const { project, workbench } = context;
  const file = project.pathOf(document);
  const proposed = file && ProjectPath.resolve(file, PROPOSED);
  if (!proposed) return;
  const target = await createDiagram(context, 'Insert diagram', ProjectPath.unique(proposed, (path) => project.has(path)));
  // the document may have moved meanwhile
  const at = project.pathOf(document);
  if (!target || !at) {
    editor.commands.focus();
    return;
  }
  insertTypstBlocks(editor, `#figure(image(${quote(ProjectPath.referenceTo(at, target))}), caption: [ ])`);
  workbench.open(target, { viewType: DIAGRAM_EDITOR });
}
