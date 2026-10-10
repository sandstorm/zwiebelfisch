// File links in raw boxes: the Source view's link tooltip on paths in every box's code (Mod+click opens), and an
// image box's path as a link. Entry of visual-view/builtins/box-links/. See ARCHITECTURE.md, "File links".
import type { DocumentLinkProvider } from '../../../../core/document-links/document-links';
import type { PathReference } from '../../../../core/paths/paths';
import type { TypstDocument } from '../../../../core/typst-document/typst-document';
import { documentLinks } from '../../../../features/source-view/source-view';
import type { VisualViewContribution } from '../../contributions/contributions';

export interface BoxLinksOptions {
  /** Where the file paths in `document` lead (default: nowhere, plain text). */
  documentLinks?(document: TypstDocument): DocumentLinkProvider | undefined;
}

/**
 * Makes the file paths in the raw boxes of every view open their file: the
 * box's code gets the Source view's `documentLinks` extension (link tooltip
 * on a path, Mod+click / Alt+Enter open it; no separate "Open …" row: it took
 * too much space).
 */
export function boxLinks(options: BoxLinksOptions = {}): VisualViewContribution {
  return {
    id: 'box-links',
    activate({ visualView, subscriptions }) {
      subscriptions.push(
        visualView.registerBoxCodeExtension((view) => {
          const links = options.documentLinks?.(view.document);
          return links ? documentLinks(links) : [];
        }),
      );
    },
  };
}

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
