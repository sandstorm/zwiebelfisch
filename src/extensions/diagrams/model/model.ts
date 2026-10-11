// What a diagram file is. See diagrams in ../diagrams.ts.
import type { PathReference, ProjectPath } from '../../../core/paths/paths';
import { quote } from '../../../core/typst-syntax/typst-syntax';

/** The extension a diagram's name ends in. */
export const DIAGRAM_EXTENSION = '.drawio.png';

/** The diagram files, PNGs with a diagrams.net diagram in them, as a custom editor's file name pattern. */
export const DIAGRAM_FILES = `*${DIAGRAM_EXTENSION}`;

/** The custom editor's view type: new and inserted diagrams open in it, even if the user chose the image preview. */
export const DIAGRAM_EDITOR = 'diagrams.editor';

/** Whether `path` is a diagram file (by name, in any case). */
export function isDiagram(path: ProjectPath): boolean {
  return path.toLowerCase().endsWith(DIAGRAM_EXTENSION);
}

/** The figure showing the diagram at `path` (as written in the document), as "Insert diagram" and a drop put it in. */
export function diagramFigure(path: PathReference): string {
  return `#figure(image(${quote(path)}), caption: [ ])`;
}
