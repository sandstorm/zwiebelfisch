// The project's files in search everywhere. See files in ../files.ts.
import { ProjectPath } from '../../../core/paths/paths';
import type { Project } from '../../../core/project/project';
import type { SearchProvider, WindowApi } from '../../../hosts/window/window';

/** "Files" (prefix `/`): every file by its name, with its path (matched too, e.g. `chapters/intro`); picking opens it. */
export function fileSearch(project: Pick<Project, 'paths'>, window: Pick<WindowApi, 'showDocument'>): SearchProvider {
  return {
    id: 'files.files',
    label: 'Files',
    prefix: '/',
    order: 10,
    provideItems: () =>
      project.paths().map((path) => ({
        label: ProjectPath.name(path),
        // the whole path, so a query with folders matches; nothing more to say for a file at the top
        description: path.indexOf('/', 1) > 0 ? ProjectPath.displayName(path) : undefined,
        accept: () => window.showDocument(path),
      })),
  };
}
