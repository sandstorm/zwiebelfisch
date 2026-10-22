import { ProjectPath } from '../../core/paths/paths';
import type { Project } from '../../core/project/project';
import { findFilePaths } from '../../core/typst-syntax/typst-syntax';
import type { DocumentDropEditProvider, DocumentLinkProvider } from '../../hosts/languages/languages';
import type { Extension } from '../../hosts/extension-host/extension-host';
import { calculateMermaidFigure, isMermaid, MERMAN } from './model/mermaid-figure';
import { registerInsertMermaid } from './visual-editor/visual-editor';
import { MERMAID_HELP } from './window/mermaid-help';

/**
 * Mermaid diagrams (`.mmd` files) as figures, drawn by the Typst package merman.
 *
 * - "Insert Mermaid diagram" (Insert menu) creates a `.mmd` file with a starter flowchart and inserts its figure and
 *   the import; so does a `.mmd` file dropped from the file panel into the text.
 * - The path of a project's `.mmd` file in Typst text is the link "Edit diagram", which opens the file.
 * - `.mmd` files get the help sheet "Mermaid basics".
 * - `mermaid` has an import source, so a pasted figure gets its import too.
 */
export function mermaid(): Extension {
  return {
    id: 'mermaid',
    activate(context) {
      const { project, languages, subscriptions } = context;
      subscriptions.push(
        registerInsertMermaid(context),
        languages.registerDocumentLinkProvider({ language: 'typst' }, mermaidLinks(project), { priority: 110 }),
        languages.registerDocumentDropEditProvider({ language: 'typst' }, mermaidDrops),
        languages.registerHelpSheet({ language: 'mermaid' }, MERMAID_HELP),
        languages.registerImportSource({ language: 'typst' }, { name: 'mermaid', module: MERMAN }),
      );
    },
  };
}

/** A Mermaid file dropped into a Typst file: its figure, with the import of merman it needs (`calculateMermaidFigure`). */
const mermaidDrops: DocumentDropEditProvider = {
  provideDocumentDropEdits({ path, text }, use, file) {
    if (!isMermaid(file)) return null;
    const { source, importChange } = calculateMermaidFigure(text, path, file, use);
    return { insertText: source, additionalEdit: importChange ? [importChange] : [] };
  },
};

/** The paths of the project's Mermaid files in Typst text as links titled "Edit diagram"; following one opens the file. */
function mermaidLinks(project: Pick<Project, 'has'>): DocumentLinkProvider {
  return {
    provideDocumentLinks: (document) =>
      findFilePaths(document).flatMap(({ path: reference, from, to }) => {
        const target = ProjectPath.resolve(document.path, reference);
        return target && isMermaid(target) && project.has(target) ? [{ range: { from, to }, target, tooltip: 'Edit diagram' }] : [];
      }),
  };
}
