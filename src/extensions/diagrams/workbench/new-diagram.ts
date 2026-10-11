// "New diagram…". See ../diagrams.ts.
import { ProjectPath } from '../../../core/paths/paths';
import type { ExtensionContext } from '../../../hosts/workbench/workbench';
import { emptyDiagram } from '../model/png';
import { DIAGRAM_EDITOR, DIAGRAM_EXTENSION } from '../model/model';

/**
 * Asks for the new diagram's name in the folder of `resource` (a file's folder, or the folder itself; default: the
 * shown file's), ending in `.drawio.png` (`window.showSaveDialog`); creates the empty diagram and opens it.
 *
 * Asks where the new `.drawio.png` goes, creates an empty diagram there and opens it; `createDiagram` is the asking and
 * creating, which "Insert diagram" shares.
 */
export async function newDiagram(context: ExtensionContext, resource = context.window.activeFile): Promise<void> {
  const target = await createDiagram(context, 'New diagram', resource);
  if (target) context.workbench.open(target, { viewType: DIAGRAM_EDITOR });
}

/**
 * Asks for a new diagram's name with `title` (`window.showSaveDialog`; `defaultUri`: a folder or file to start in,
 * or a free name to propose), ending in `.drawio.png`, and creates the empty diagram there through
 * `workspace.applyEdit`. Resolves to its path; undefined when cancelled or refused (a refusal is an error message).
 */
export async function createDiagram(
  { window, workspace }: Pick<ExtensionContext, 'window' | 'workspace'>,
  title: string,
  defaultUri: ProjectPath | undefined,
): Promise<ProjectPath | undefined> {
  const target = await window.showSaveDialog({ title, defaultUri, filters: { Diagrams: [DIAGRAM_EXTENSION.slice(1)] } });
  if (!target) return undefined;
  const problem = await workspace.applyEdit({ kind: 'create', path: target, content: emptyDiagram() });
  if (!problem) return target;
  void window.showErrorMessage(`${ProjectPath.displayName(target)} not created: ${problem}`);
  return undefined;
}
