import { findFilePaths } from '../../core/typst-syntax/typst-syntax';
import { ProjectPath } from '../../core/paths/paths';
import type { Project } from '../../core/project/project';
import type { TypstExtension } from '../../hosts/workbench/workbench';
import type { DocumentLink, DocumentLinkProvider, TextDocument } from '../../hosts/languages/languages';

/**
 * The file paths in Typst text (`#include "ch1.typ"`, `image("logo.png")`) as document links. A path resolves from the
 * file it is in. Its link opens an existing file, or says the file is missing and, for a Typst file, offers to create
 * it: the command `documentLinks.createFile(path)` creates it through `workspace.applyEdit` and opens it, or rejects
 * saying why not.
 *
 * The work is split three ways. Finding paths is Typst syntax (core/typst-syntax). Showing and following links is the
 * hosts': every editor shows the links of every DocumentLinkProvider for its language (the Source editors, raw boxes'
 * code and pictures; the images extension asks for the link on an image box's path). Where a path leads in this
 * project, and that a missing Typst file may be created, is this extension's policy. Other extensions put their own
 * links on some paths with a higher priority (the diagrams' "Edit diagram").
 * See docs/40_architecture/12_source-editor-and-preview.typ.
 */
export function documentLinks(): TypstExtension {
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
