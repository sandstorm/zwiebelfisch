import { ProjectPath } from '../../core/paths/paths';
import type { Project } from '../../core/project/project';
import { findFilePaths } from '../../core/typst-syntax/typst-syntax';
import type { DocumentLinkProvider } from '../../hosts/languages/languages';
import type { TypstExtension } from '../../hosts/workbench/workbench';
import { isMermaid, MERMAN } from './model/mermaid-figure';
import { insertMermaid } from './visual-editor/visual-editor';
import { MERMAID_HELP } from './workbench/mermaid-help';

/**
 * Mermaid diagrams as figures, drawn by the Typst package merman while Typst compiles.
 *
 * "Insert Mermaid diagram" (Insert menu) creates a `.mmd` file with a starter flowchart and inserts its figure and the
 * import. In Typst text, the path of a project's `.mmd` file (`read("x.mmd")`) becomes the link "Edit diagram"
 * (priority 110, over the plain file link), so ⌘/Ctrl+click on the path or on the box's picture opens the file.
 * `.mmd` files get the help sheet "Mermaid basics". `mermaid` is declared to come from merman, so a figure pasted from
 * elsewhere gets its import.
 *
 * All of it goes through the hosts' generic points: a toolbar item, a document link provider, a help provider, a known
 * import (`languages.registerKnownImport`). The file
 * opens in whatever editor `.mmd` has (the text-files extension's). Typst draws the diagram, so nothing is rendered
 * here. See docs/10_guide/02_features.typ, "Mermaid diagrams".
 */
export function mermaid(): TypstExtension {
  return {
    id: 'mermaid',
    activate(context) {
      const { project, languages, visualEditor, subscriptions } = context;
      subscriptions.push(
        visualEditor.registerToolbarItem(insertMermaid(context)),
        languages.registerDocumentLinkProvider({ language: 'typst' }, mermaidLinks(project), { priority: 110 }),
        languages.registerHelpProvider({ language: 'mermaid' }, { provideHelp: () => MERMAID_HELP }),
        languages.registerKnownImport({ language: 'typst' }, { name: 'mermaid', module: MERMAN }),
      );
    },
  };
}

/** The paths of the project's Mermaid files in Typst text as links titled "Edit diagram"; following one opens the file. */
function mermaidLinks(project: Pick<Project, 'has'>): DocumentLinkProvider {
  return {
    provideDocumentLinks: ({ path, text }) =>
      findFilePaths(text).flatMap(({ path: reference, from, to }) => {
        const target = ProjectPath.resolve(path, reference);
        return target && isMermaid(target) && project.has(target) ? [{ range: { from, to }, target, tooltip: 'Edit diagram' }] : [];
      }),
  };
}
