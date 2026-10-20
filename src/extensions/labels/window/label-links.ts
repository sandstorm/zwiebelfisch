// References and links to labels as document links. See labels in ../labels.ts.
import { ProjectPath } from '../../../core/paths/paths';
import type { Project } from '../../../core/project/project';
import type { DocumentLink, DocumentLinkProvider, TextDocument } from '../../../hosts/languages/languages';
import { describeLabel } from '../model/label-description';
import type { ProjectLabels } from '../model/label-index';
import { findLabel, findLabelLinks } from '../model/scan';

/**
 * References (`@intro`) and links to labels (`#link(<intro>)[..]`) as document links: following one goes to the label,
 * in whichever file it is, with the caret at it; the hover says what it labels ("Go to Section · Introduction in
 * intro.typ"). A link to a label the project lacks leads nowhere.
 */
export class LabelLinks implements DocumentLinkProvider {
  /** The label each link given out points to. */
  readonly #names = new WeakMap<DocumentLink, string>();

  constructor(
    private readonly labels: Pick<ProjectLabels, 'labels'>,
    private readonly project: Pick<Project, 'document'>,
  ) {}

  provideDocumentLinks(document: TextDocument): DocumentLink[] {
    return findLabelLinks(document).map(({ name, range }) => {
      const link: DocumentLink = { range };
      this.#names.set(link, name);
      return link;
    });
  }

  resolveDocumentLink(link: DocumentLink): DocumentLink {
    const name = this.#names.get(link);
    const label = name === undefined ? undefined : this.labels.labels().find((candidate) => candidate.name === name);
    if (!label) return link;
    const tooltip = `Go to ${describeLabel(label) ?? `<${label.name}>`} in ${ProjectPath.displayName(label.path)}`;
    const at = ProjectPath.isTypst(label.path) ? findLabel(this.project.document(label.path) ?? '', label.name) : null;
    return { ...link, target: label.path, tooltip, ...(at === null ? {} : { selection: { from: at, to: at } }) };
  }
}
