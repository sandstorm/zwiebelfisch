// The document-links extension: the file paths in Typst text (`#include "ch1.typ"`, `image("logo.png")`) as document
// links, which open the file or offer to create a missing Typst file. Entry of extensions/document-links/. See
// ARCHITECTURE.md, "File links".
// Why an extension: finding paths is Typst syntax (core/document-links), showing and following links is the hosts'
// (every view shows the links of every `DocumentLinkProvider`); where a path leads in this project, and that a missing
// Typst file may be created, is this extension's policy.
import { findFilePaths } from '../../core/document-links/document-links';
import { ProjectPath } from '../../core/paths/paths';
import type { Project } from '../../core/project/project';
import type { DocumentLink, DocumentLinkProvider, TextDocument, TypstExtension, Workbench } from '../../hosts/workbench/workbench';

/**
 * Links the file paths of all Typst text (the Source views, raw boxes, an image box's path): they resolve from the
 * file's path, open an existing file, and create a missing Typst file through `Workbench.applyChange`.
 */
export function documentLinks(): TypstExtension {
  return {
    id: 'document-links',
    activate({ project, workbench, subscriptions }) {
      subscriptions.push(workbench.registerDocumentLinkProvider(new FilePathLinks(project, workbench)));
    },
  };
}

/** The file paths of a text as links; resolved, a link opens its file, or says it is missing (and offers to create a Typst file). */
class FilePathLinks implements DocumentLinkProvider {
  /** Where each link given out leads (null: out of the project). */
  readonly #targets = new WeakMap<DocumentLink, ProjectPath | null>();

  constructor(
    private readonly project: Project,
    private readonly workbench: Pick<Workbench, 'applyChange' | 'open'>,
  ) {}

  provideDocumentLinks({ path, text }: TextDocument): DocumentLink[] {
    return findFilePaths(text).map(({ path: reference, from, to }) => {
      const link: DocumentLink = { range: { from, to } };
      this.#targets.set(link, ProjectPath.resolve(path, reference));
      return link;
    });
  }

  resolveDocumentLink(link: DocumentLink): DocumentLink {
    const target = this.#targets.get(link);
    if (!target) return link;
    if (this.project.has(target)) return { ...link, target };
    const name = ProjectPath.displayName(target);
    const tooltip = `${name} is not in the project`;
    if (ProjectPath.kind(target) !== 'typst') return { ...link, tooltip };
    return { ...link, tooltip, command: { title: `Create ${name}`, run: () => this.create(target) } };
  }

  /** Creates the empty Typst file `path` and opens it; resolves to why that was refused, or null. */
  private async create(path: ProjectPath): Promise<string | null> {
    const problem = await this.workbench.applyChange({ kind: 'create', path, content: '' });
    if (problem === null) this.workbench.open(path);
    return problem;
  }
}
