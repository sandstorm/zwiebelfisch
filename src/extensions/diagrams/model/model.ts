// The diagrams extension's model: the embed protocol as pure state (embed-session.ts), the diagram inside a PNG
// (png.ts), the empty diagram (empty-diagram.ts). No DOM, no editor library.
// See ../diagrams.ts.
import type { ProjectPath } from '../../../core/paths/paths';

/** The diagram files: PNGs with a diagrams.net diagram in them. */
export const DIAGRAM_FILES = '*.drawio.png';

/** The extension a diagram's name ends in. */
export const DIAGRAM_EXTENSION = '.drawio.png';

/** Whether `path` is a diagram file (by name, in any case). */
export function isDiagram(path: ProjectPath): boolean {
  return path.toLowerCase().endsWith(DIAGRAM_EXTENSION);
}
