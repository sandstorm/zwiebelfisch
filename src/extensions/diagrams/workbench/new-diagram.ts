// "New diagram…": asks for a name and creates an empty `.drawio.png` there, then opens it. See ../diagrams.ts.
import { ProjectPath } from '../../../core/paths/paths';
import type { Project } from '../../../core/project/project';
import type { Workbench } from '../../../hosts/workbench/workbench';
import { DIAGRAM_EXTENSION } from '../model/model';
import { emptyDiagram } from '../model/empty-diagram';

/**
 * Asks for the new diagram's name in the folder of `resource` (a file's folder, or the folder itself; default: the
 * shown file's), adding `.drawio.png`; creates the empty diagram through `applyChange` and opens it. A refusal is an
 * error message.
 */
export async function newDiagram(project: Project, workbench: Workbench, resource = workbench.activeFile): Promise<void> {
  const folder = project.has(resource) ? resource.slice(0, resource.lastIndexOf('/')) : resource;
  const value = folder === '' ? '' : `${folder.slice(1)}/`;
  const name = await workbench.showInputBox({
    title: 'New diagram',
    prompt: 'Name of the new diagram',
    value,
    valueSelection: [value.length, value.length],
    placeHolder: 'e.g. architecture',
    validateInput: (typed) => problemWith(project, diagramPath(typed)),
  });
  const target = name === undefined ? null : diagramPath(name);
  if (!target || !('path' in target) || problemWith(project, target)) return;
  const problem = await workbench.applyChange({ kind: 'create', path: target.path, content: emptyDiagram() });
  if (problem) void workbench.showErrorMessage(`${ProjectPath.displayName(target.path)} not created: ${problem}`);
  else workbench.open(target.path);
}

/** The path of a diagram named `typed` ("architecture", "img/flow.drawio.png"). */
function diagramPath(typed: string): { path: ProjectPath } | { error: string } {
  return ProjectPath.fromName(typed.replace(/\.drawio(\.png)?$/i, ''), DIAGRAM_EXTENSION);
}

function problemWith(project: Project, target: { path: ProjectPath } | { error: string }): string | null {
  if ('error' in target) return target.error;
  if (!target.path.endsWith(DIAGRAM_EXTENSION)) return `A diagram’s name ends in ${DIAGRAM_EXTENSION}.`;
  return project.has(target.path) ? `${ProjectPath.displayName(target.path)} already exists.` : null;
}
