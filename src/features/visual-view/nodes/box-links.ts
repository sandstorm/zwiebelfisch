// File links on raw boxes: a clickable path in an image box's heading. (Paths in a box's code get the
// Source view's link tooltip.) See raw-box.ts and ARCHITECTURE.md, "File links".
import { describeLink, type FileLinks } from '../../../core/project/project';

/** An image box's path as a button that opens the file, or the path marked as missing. */
export function imagePathLink(doc: Document, links: FileLinks, path: string): Node {
  const target = describeLink(links, path);
  if (!target?.exists) {
    const missing = doc.createElement('span');
    missing.className = 'typst-visual__path typst-visual__path--missing';
    missing.textContent = path;
    missing.title = target ? `${target.name} is not in the project` : 'Outside the project';
    return missing;
  }
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'typst-visual__path';
  button.textContent = path;
  button.title = `Open ${target.name}`;
  button.addEventListener('mousedown', (event) => event.preventDefault());
  button.addEventListener('click', () => links.open(target.path));
  return button;
}
