// The mermaid extension. Entry of extensions/mermaid/. See docs/10_guide/02_features.typ.
import { ProjectPath } from '../../core/paths/paths';
import type { Project } from '../../core/project/project';
import { findFilePaths } from '../../core/typst-syntax/typst-syntax';
import type { DocumentLinkProvider } from '../../hosts/languages/languages';
import type { TypstExtension } from '../../hosts/workbench/workbench';
import { isMermaid } from './model/mermaid-figure';
import { insertMermaid } from './visual-editor/visual-editor';
import { MERMAID_HELP } from './workbench/mermaid-help';

/**
 * "Insert Mermaid diagram" in the Visual editor's Insert menu; the paths of the project's Mermaid files in Typst
 * (`read("x.mmd")`) as links "Edit diagram" (priority 110, over the plain file links), so ⌘/Ctrl+click on a box
 * reading one (or on its path) opens it; the help sheet "Mermaid basics" for `.mmd` files (language `mermaid`).
 *
 * Mermaid diagrams as figures drawn by the merman package while Typst compiles — "Insert Mermaid diagram" (a new `.mmd`
 * file with a starter flowchart, its figure and the import in the text) and "Edit diagram" (⌘/Ctrl+click) on a box
 * reading one.
 *
 * Why an extension: the entry is a toolbar item and the edit a document link (which the Visual editor's boxes follow
 * from their picture), the `.mmd` file opens in whichever editor its pattern has (the text editor): the hosts' generic
 * contribution points, no other extension named. Typst draws the diagram, so there is nothing to render here.
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
