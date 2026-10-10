// File links in raw boxes: the Source view's link tooltip on paths in every box's code (Mod+click opens). Entry of extensions/document-links/visual-view/. See ARCHITECTURE.md, "File links".
import type { DocumentLinkProvider } from '../../../core/document-links/document-links';
import type { TypstDocument } from '../../../core/typst-document/typst-document';
import { documentLinks } from '../source-view/source-view';
import type { VisualViewContribution } from '../../../hosts/visual-view/visual-view';

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
