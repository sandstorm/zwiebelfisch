// The diagrams extension in the Visual view: "Edit diagram" on a box that shows a `.drawio.png` (an image box, or
// any raw box naming one), through the host's generic box actions.
// See ../diagrams.ts.
import type { ProjectPath } from '../../../core/paths/paths';
import type { TypstDocument } from '../../../core/typst-document/typst-document';
import type { BoxAction } from '../../../hosts/visual-view/visual-view';

/** The diagram file the Typst `src` of a box in `document` shows, or null. */
export type DiagramOf = (src: string, document: TypstDocument) => ProjectPath | null;

/**
 * "Edit diagram" on every box whose Typst names a diagram file of the project: `diagramOf` finds it (from the
 * workbench's document links, so the extension parses no Typst), `open` shows it in the diagram editor.
 */
export function editDiagramAction(diagramOf: DiagramOf, open: (path: ProjectPath) => void): BoxAction {
  return {
    title: 'Edit diagram',
    when: (node, view) => diagramOf(node.attrs.src, view.document) !== null,
    run: (node, view) => {
      const diagram = diagramOf(node.attrs.src, view.document);
      if (diagram) open(diagram);
    },
  };
}
