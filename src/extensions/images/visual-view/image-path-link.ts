// An image box's path as a link to the file. See images.ts.
import type { DocumentLinkProvider } from '../../../core/document-links/document-links';
import type { PathReference } from '../../../core/paths/paths';

/** An image box's path as a button that opens the file, or the path marked as missing. */
export function imagePathLink(links: DocumentLinkProvider, path: PathReference, doc: Document): Node {
  const target = links.resolveDocumentLink(path);
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
  button.addEventListener('click', () => void links.followDocumentLink(target));
  return button;
}
