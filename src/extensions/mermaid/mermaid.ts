// The mermaid extension: Mermaid diagrams as figures drawn by the merman package while Typst compiles — "Insert
// Mermaid diagram" (a new `.mmd` file with a starter flowchart, its figure and the import in the text) and "Edit
// diagram" on a box reading one. Entry of extensions/mermaid/. See docs/10_guide/02_features.typ.
// Why an extension: the entry is a toolbar item and the edit a box action, the `.mmd` file opens in whichever editor
// its pattern has (the text editor) and the file a box reads is found through the document links: the hosts' generic
// contribution points, no other extension named. Typst draws the diagram, so there is nothing to render here.
import type { ProjectPath } from '../../core/paths/paths';
import type { Project } from '../../core/project/project';
import type { TypstDocument } from '../../core/typst-document/typst-document';
import type { Languages } from '../../hosts/languages/languages';
import type { TypstExtension } from '../../hosts/workbench/workbench';
import { isMermaid } from './model/mermaid-figure';
import { editMermaidAction, insertMermaid } from './visual-editor/visual-editor';

/**
 * "Insert Mermaid diagram" in the Visual editor's Insert menu; "Edit diagram" on Visual editor boxes whose Typst reads a
 * Mermaid file of the project (`read("x.mmd")`), opening it.
 */
export function mermaid(): TypstExtension {
  return {
    id: 'mermaid',
    activate(context) {
      const { project, languages, workbench, visualEditor, subscriptions } = context;
      subscriptions.push(
        visualEditor.registerToolbarItem(insertMermaid(context)),
        visualEditor.registerRawBoxAction(editMermaidAction(mermaidIn(project, languages), (path) => workbench.open(path))),
      );
    },
  };
}

/** The Mermaid file of the project a box's Typst reads: the first document link (any provider's) that leads to one. */
function mermaidIn(project: Project, languages: Languages): (src: string, document: TypstDocument) => ProjectPath | null {
  return (src, document) => {
    const file = project.pathOf(document);
    if (!file) return null;
    // the providers read Typst markup; a figure's body is written in code (`mermaid(..)`, no `#`)
    const markup = src.startsWith('#') ? src : `#${src}`;
    for (const link of languages.provideDocumentLinks({ path: file, languageId: 'typst', text: markup })) {
      const target = languages.resolveDocumentLink(link).target;
      if (target && isMermaid(target)) return target;
    }
    return null;
  };
}
