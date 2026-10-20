// The mermaid extension in the Visual editor. See mermaid in ../mermaid.ts.
import { PathReference, ProjectPath } from '../../../core/paths/paths';
import { Disposable } from '../../../core/disposable/disposable';
import { insertTypst, svg, type VisualEditorMenuContext } from '../../../hosts/visual-editor/visual-editor';
import type { ExtensionContext } from '../../../hosts/workbench/workbench';
import { calculateMermaidFigure, MERMAID_EXTENSION, STARTER_FLOWCHART } from '../model/mermaid-figure';

/**
 * "Insert Mermaid diagram" in the Insert menu: asks for the new file's name (proposing a free `diagrams/diagram.mmd`
 * next to the document), creates it with a starter flowchart, inserts
 * `#figure(mermaid(read("…"), width: 100%), caption: [ ])` after the cursor's block with the import it needs (one
 * undo step), and opens the file.
 */
export function registerInsertMermaid(context: InsertContext): Disposable {
  return Disposable.from(
    context.commands.registerCommand(INSERT_MERMAID, (menu: VisualEditorMenuContext) => insert(context, menu)),
    context.workbench.registerMenuItem('visualEditor/insert', {
      command: INSERT_MERMAID,
      title: 'Insert Mermaid diagram',
      icon: ICON,
      keywords: ['mermaid', 'diagram', 'flowchart', 'sequence', 'chart', 'figure'],
      order: 14,
    }),
  );
}

/** What inserting a diagram uses of the extension context. */
export type InsertContext = Pick<ExtensionContext, 'project' | 'window' | 'workspace' | 'workbench' | 'commands'>;

/** "Insert Mermaid diagram" (the command's argument: the Visual editor menu context). */
const INSERT_MERMAID = 'mermaid.insertDiagram';

const ICON = svg('<circle cx="5" cy="6" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M7 6h10M6 8l5 8.3M18 8l-5 8.3"/>');

async function insert({ project, window, workspace, workbench }: InsertContext, menu: VisualEditorMenuContext): Promise<void> {
  const { editor, document } = menu;
  const file = project.pathOf(document);
  const proposed = file && ProjectPath.resolve(file, PROPOSED);
  if (!proposed) return;
  const target = await window.showSaveDialog({ title: 'Insert Mermaid diagram', defaultUri: ProjectPath.unique(proposed, (path) => project.has(path)), filters: { Mermaid: [MERMAID_EXTENSION.slice(1)] } });
  if (!target) {
    editor.commands.focus();
    return;
  }
  const problem = await workspace.applyEdit({ kind: 'create', path: target, content: STARTER_FLOWCHART });
  if (problem) {
    void window.showErrorMessage(`${ProjectPath.displayName(target)} not created: ${problem}`);
    return;
  }
  // the document may have moved meanwhile
  const at = project.pathOf(document);
  if (!at) return;
  const { source, importChange } = calculateMermaidFigure(document.text, at, target, menu.selection().from);
  insertTypst(editor, source, undefined, importChange ? [importChange] : []);
  workbench.open(target);
}

/** Where a new diagram is proposed, relative to the document. */
const PROPOSED = PathReference.of(`diagrams/diagram${MERMAID_EXTENSION}`);
