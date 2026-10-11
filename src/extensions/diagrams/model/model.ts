// The diagrams extension's model: the embed protocol as pure state (embed-session.ts), the diagram inside a PNG
// (png.ts, also the empty diagram). No DOM, no editor library.
// See ../diagrams.ts.
import type { ProjectPath } from '../../../core/paths/paths';

/** The extension a diagram's name ends in. */
export const DIAGRAM_EXTENSION = '.drawio.png';

/** The diagram files, PNGs with a diagrams.net diagram in them, as a custom editor's file name pattern. */
export const DIAGRAM_FILES = `*${DIAGRAM_EXTENSION}`;

/** The custom editor's view type: diagrams open in it when asked to be edited, even if the user chose the image preview. */
export const DIAGRAM_EDITOR = 'diagrams.editor';

/** Whether `path` is a diagram file (by name, in any case). */
export function isDiagram(path: ProjectPath): boolean {
  return path.toLowerCase().endsWith(DIAGRAM_EXTENSION);
}
