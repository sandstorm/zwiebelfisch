// The figures of every Typst file in search everywhere. See figures in ../figures.ts.
import { ProjectPath } from '../../../core/paths/paths';
import type { Project } from '../../../core/project/project';
import type { SearchProvider, WindowApi } from '../../../hosts/window/window';
import { findFigures, type FoundFigure } from '../model/find-figures';

/**
 * "Figures" (prefix `@`, with the labels): the figures of every Typst file (tables and listings too) by caption, else
 * label, with kind, label and file (the label matches as well); picking one opens its file at the figure. A file is
 * read again only when it changed.
 */
export function figureSearch(project: Pick<Project, 'paths' | 'document'>, window: Pick<WindowApi, 'showDocument'>): SearchProvider {
  let scans = new Map<ProjectPath, { text: string; figures: FoundFigure[] }>();
  return {
    id: 'figures.figures',
    label: 'Figures',
    prefix: '@',
    order: 31,
    provideItems: () => {
      const next = new Map<ProjectPath, { text: string; figures: FoundFigure[] }>();
      for (const path of project.paths().filter(ProjectPath.isTypst)) {
        const text = project.document(path)?.text ?? '';
        const known = scans.get(path);
        next.set(path, known?.text === text ? known : { text, figures: findFigures(text) });
      }
      scans = next;
      return [...next].flatMap(([path, { figures }]) =>
        figures.map(({ caption, kind, label, at }) => ({
          label: caption ?? `<${label}>`,
          description: [kind, caption && label ? `<${label}>` : null, ProjectPath.displayName(path)].filter(Boolean).join(' · '),
          accept: () => window.showDocument(path, { selection: { from: at, to: at } }),
        })),
      );
    },
  };
}
