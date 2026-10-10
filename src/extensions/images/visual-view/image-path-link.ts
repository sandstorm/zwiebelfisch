// An image box's path as a link to the file (the document link on it). See images.ts.
import { type PathReference, ProjectPath } from '../../../core/paths/paths';
import type { DocumentLink } from '../../../hosts/workbench/workbench';

/** An image box's path as a button that opens the link's target, or the path marked as leading nowhere (with the link's tooltip). */
export function imagePathLink(link: DocumentLink | null, path: PathReference, doc: Document, open: (target: ProjectPath) => void): Node {
  const target = link?.target;
  if (!target) {
    const missing = doc.createElement('span');
    missing.className = 'typst-visual__path typst-visual__path--missing';
    missing.textContent = path;
    missing.title = link?.tooltip ?? 'Outside the project';
    return missing;
  }
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'typst-visual__path';
  button.textContent = path;
  button.title = `Open ${ProjectPath.displayName(target)}`;
  button.addEventListener('mousedown', (event) => event.preventDefault());
  button.addEventListener('click', () => open(target));
  return button;
}
