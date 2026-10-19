import { findFilePaths } from '../../core/typst-syntax/typst-syntax';
import { ProjectPath } from '../../core/paths/paths';
import type { Project } from '../../core/project/project';
import type { Extension } from '../../hosts/workbench/workbench';
import type { DocumentLink, DocumentLinkProvider, TextDocument } from '../../hosts/languages/languages';

/**
 * The file paths in Typst text (`#include "ch1.typ"`, `image("logo.png")`) as document links. A path resolves from the
 * file it is in. Its link opens an existing file, or says the file is missing and, for a Typst file, offers to create it.
 *
 * The command `documentLinks.createFile(path)` creates the file and opens it, or rejects saying why not.
 */
export function documentLinks(): Extension {
  return {
    id: 'document-links',
    activate({ project, commands, languages, workspace, workbench, subscriptions }) {
      subscriptions.push(
        languages.registerDocumentLinkProvider({ language: 'typst' }, new FilePathLinks(project)),
        commands.registerCommand(CREATE_FILE, async (path: string) => {
          const target = ProjectPath.parse(path);
          if (!target) throw new Error(`Not a project path: ${path}`);
          const problem = await workspace.applyEdit({ kind: 'create', path: target, content: '' });
          if (problem !== null) throw new Error(problem);
          workbench.open(target);
        }),
      );
    },
  };
}

/** The file paths of a text as links; resolved, a link opens its file, or says it is missing (and offers to create a Typst file). */
class FilePathLinks implements DocumentLinkProvider {
  /** Where each link given out leads (null: out of the project). */
  readonly #targets = new WeakMap<DocumentLink, ProjectPath | null>();

  constructor(private readonly project: Project) {}

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
    if (!ProjectPath.isTypst(target)) return { ...link, tooltip };
    return { ...link, tooltip, command: { title: `Create ${name}`, command: CREATE_FILE, arguments: [target] } };
  }
}

const CREATE_FILE = 'documentLinks.createFile';
