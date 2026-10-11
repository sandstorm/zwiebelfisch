// "New diagram…": asks where the new `.drawio.png` goes, creates an empty diagram there and opens it. See ../diagrams.ts.
import { ProjectPath } from '../../../core/paths/paths';
import type { ExtensionContext } from '../../../hosts/workbench/workbench';
import { emptyDiagram } from '../model/empty-diagram';
import { DIAGRAM_EXTENSION } from '../model/model';

/**
 * Asks for the new diagram's name in the folder of `resource` (a file's folder, or the folder itself; default: the
 * shown file's), ending in `.drawio.png` (`window.showSaveDialog`); creates the empty diagram through
 * `workspace.applyEdit` and opens it. A refusal is an error message.
 */
export async function newDiagram({ window, workspace, workbench }: ExtensionContext, resource = window.activeFile): Promise<void> {
  const target = await window.showSaveDialog({ title: 'New diagram', defaultUri: resource, filters: { Diagrams: [DIAGRAM_EXTENSION.slice(1)] } });
  if (!target) return;
  const problem = await workspace.applyEdit({ kind: 'create', path: target, content: emptyDiagram() });
  if (problem) void window.showErrorMessage(`${ProjectPath.displayName(target)} not created: ${problem}`);
  else workbench.open(target);
}
