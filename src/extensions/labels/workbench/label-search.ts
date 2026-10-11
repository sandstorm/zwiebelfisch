// The project's labels in search everywhere. See ../labels.ts and docs/10_guide/02_features.typ.
import { ProjectPath } from '../../../core/paths/paths';
import type { Project } from '../../../core/project/project';
import type { SearchProvider } from '../../../hosts/window/window';
import type { Workbench } from '../../../hosts/workbench/workbench';
import { describeLabel } from '../model/label-description';
import type { ProjectLabels } from '../model/label-index';
import { findLabel, type LabelKind } from '../model/scan';

/** Labels search everywhere leaves to others: figures (the figures' own group finds them by caption), bibliography keys. */
const ELSEWHERE = new Set<LabelKind | null>(['figure', 'table', 'listing', 'bibliography']);

/**
 * "Labels" (prefix `@`, as references are written): the Typst labels of headings, equations and anything else but
 * figures, by name, with what they label ("Section · Introduction") and their file; picking one opens the file at the
 * label.
 */
export function labelSearch(labels: Pick<ProjectLabels, 'labels'>, project: Pick<Project, 'document'>, workbench: Pick<Workbench, 'open'>): SearchProvider {
  return {
    id: 'labels.labels',
    label: 'Labels',
    prefix: '@',
    order: 30,
    provideItems: () =>
      labels
        .labels()
        .filter((label) => !ELSEWHERE.has(label.kind))
        .map((label) => ({
          label: label.name,
          description: [describeLabel(label), ProjectPath.displayName(label.path)].filter(Boolean).join(' · '),
          accept: () => {
            const at = findLabel(project.document(label.path)?.text ?? '', label.name);
            workbench.open(label.path, at === null ? {} : { selection: { from: at, to: at } });
          },
        })),
  };
}
