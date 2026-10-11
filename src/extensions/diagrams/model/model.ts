// The diagrams extension's model. See ../diagrams.ts.
import type { ProjectPath } from '../../../core/paths/paths';

/**
 * The extension a diagram's name ends in.
 *
 * The embed protocol as pure state (embed-session.ts), the diagram inside a PNG (png.ts, also the empty diagram). No
 * DOM, no editor library.
 */
export const DIAGRAM_EXTENSION = '.drawio.png';

/** The diagram files, PNGs with a diagrams.net diagram in them, as a custom editor's file name pattern. */
export const DIAGRAM_FILES = `*${DIAGRAM_EXTENSION}`;

/** The custom editor's view type: new and inserted diagrams open in it, even if the user chose the image preview. */
export const DIAGRAM_EDITOR = 'diagrams.editor';

/** Whether `path` is a diagram file (by name, in any case). */
export function isDiagram(path: ProjectPath): boolean {
  return path.toLowerCase().endsWith(DIAGRAM_EXTENSION);
}
