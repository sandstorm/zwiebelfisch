// The mermaid extension in the Visual editor. See ../mermaid.ts.
import { PathReference, ProjectPath } from '../../../core/paths/paths';
import { insertTypst, svg, type ToolbarContext, type ToolbarItem } from '../../../hosts/visual-editor/visual-editor';
import type { ExtensionContext } from '../../../hosts/workbench/workbench';
import { calculateMermaidFigure, MERMAID_EXTENSION, STARTER_FLOWCHART } from '../model/mermaid-figure';

/**
 * "Insert Mermaid diagram": asks for the new file's name (`window.showSaveDialog`, proposing a free
 * `diagrams/diagram.mmd` next to the document), creates it with a starter flowchart, inserts
 * `#figure(mermaid(read("…"), width: 100%), caption: [ ])` after the cursor's block with the import of merman it
 * needs, and opens the file (in whichever editor `.mmd` files open: the text editor), where the diagram is written.
 *
 * "Insert Mermaid diagram" in the Insert menu (and so among the slash commands).
 */
export function insertMermaid(context: InsertContext): ToolbarItem {
  return {
    group: 'insert',
    order: 14,
    create: (toolbar) => ({
      label: 'Insert Mermaid diagram',
      icon: ICON,
      keywords: ['mermaid', 'diagram', 'flowchart', 'sequence', 'chart', 'figure'],
      click: () => void insert(context, toolbar),
    }),
  };
}

/** What inserting a diagram uses of the extension context. */
export type InsertContext = Pick<ExtensionContext, 'project' | 'window' | 'workspace' | 'workbench'>;

const ICON = svg('<circle cx="5" cy="6" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M7 6h10M6 8l5 8.3M18 8l-5 8.3"/>');

async function insert({ project, window, workspace, workbench }: InsertContext, toolbar: ToolbarContext): Promise<void> {
  const { editor, document } = toolbar;
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
  const { source, importChange } = calculateMermaidFigure(document.text, at, target, toolbar.selection().from);
  if (importChange) document.change([importChange], INSERT_MERMAID);
  insertTypst(editor, source);
  workbench.open(target);
}

/** Where a new diagram is proposed, relative to the document. */
const PROPOSED = PathReference.of(`diagrams/diagram${MERMAID_EXTENSION}`);
/** The origin of the import change (the document's listeners see who changed it). */
const INSERT_MERMAID = 'mermaid.insertDiagram';
