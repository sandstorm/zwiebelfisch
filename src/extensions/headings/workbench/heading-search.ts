// The headings of every Typst file in search everywhere. See headings in ../headings.ts.
import { ProjectPath } from '../../../core/paths/paths';
import type { Project } from '../../../core/project/project';
import type { SearchProvider } from '../../../hosts/window/window';
import type { Workbench } from '../../../hosts/workbench/workbench';
import { findHeadings, type FoundHeading } from '../model/find-headings';

/**
 * "Headings" (prefix `#`): the headings of every Typst file, in reading order of the project's files, with their level
 * and file; picking one opens its file with the cursor at the heading. A file is read again only when it changed.
 */
export function headingSearch(project: Pick<Project, 'paths' | 'document'>, workbench: Pick<Workbench, 'open'>): SearchProvider {
  let scans = new Map<ProjectPath, { text: string; headings: FoundHeading[] }>();
  return {
    id: 'headings.headings',
    label: 'Headings',
    prefix: '#',
    order: 20,
    provideItems: () => {
      const next = new Map<ProjectPath, { text: string; headings: FoundHeading[] }>();
      for (const path of project.paths().filter(ProjectPath.isTypst)) {
        const text = project.document(path)?.text ?? '';
        const known = scans.get(path);
        next.set(path, known?.text === text ? known : { text, headings: findHeadings(text) });
      }
      scans = next;
      return [...next].flatMap(([path, { headings }]) =>
        headings.map(({ level, title, range }) => ({
          label: title,
          description: `H${level} · ${ProjectPath.displayName(path)}`,
          accept: () => workbench.open(path, { selection: { from: range.from, to: range.from } }),
        })),
      );
    },
  };
}
