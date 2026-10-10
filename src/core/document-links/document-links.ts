// DocumentLinkProvider: the file paths a Typst document names (`#import`, `#include`, `image(…)`, `read(…)`, …),
// where each one leads in the workspace, and following one (open the file, or create a missing Typst file).
// The views use it to make paths clickable; it reads Typst syntax, the workspace owns the files.
// Entry of core/document-links/. See ARCHITECTURE.md, "File links".
import type { Tree } from '@lezer/common';
import { displayName, fileKind } from '../paths/paths';
import { documentLinkAt, provideDocumentLinks, type DocumentLink } from './find-links';

export type { DocumentLink, LinkCall } from './find-links';
export { neighbours, readingOrder } from './reading-order';

/** What a DocumentLinkProvider needs from the workspace, for one document (paths resolve from its current path). */
export interface LinkWorkspace {
  /** The workspace path `reference` (as written in this document) points to; null when it leaves the workspace. */
  resolve(reference: string): string | null;
  exists(path: string): boolean;
  /** Shows the file (like the widget's `open`). */
  open(path: string): void;
  /** Creates the empty Typst file `path` and opens it; resolves to why that was refused, or null. */
  create(path: string): Promise<string | null>;
}

/** Where a link leads, and what following it does: open an existing file, or create a missing Typst file. */
export interface LinkTarget {
  path: string;
  /** The path as shown to people. */
  name: string;
  exists: boolean;
  /** Missing, and a Typst file that can be created empty. */
  creatable: boolean;
}

/** The links of one Typst document, against its workspace. */
export class DocumentLinkProvider {
  constructor(private readonly workspace: LinkWorkspace) {}

  /**
   * The file paths `text` names: the string of `#import "…"` / `#include "…"`
   * and the first positional argument of `image`, `read`, `json`, `csv`,
   * `yaml`, `toml`, `xml`, `cbor` and `bibliography` (each string of a
   * bibliography array). Package imports, empty strings, computed paths and
   * methods (`image.decode`) are left out. Pass the `tree` when the text is
   * parsed already (an editor's syntax tree), and `from`/`to` to look at a part only.
   */
  provideDocumentLinks(text: string, options: { tree?: Tree; from?: number; to?: number } = {}): DocumentLink[] {
    return provideDocumentLinks(text, options);
  }

  /** The link whose string (quotes included) holds `offset`, or null. */
  documentLinkAt(text: string, offset: number, tree?: Tree): DocumentLink | null {
    return documentLinkAt(text, offset, tree);
  }

  /** Where the path `reference` (as written) leads; null when it leaves the workspace. */
  resolveDocumentLink(reference: string): LinkTarget | null {
    const path = this.workspace.resolve(reference);
    if (path === null) return null;
    const exists = this.workspace.exists(path);
    return { path, name: displayName(path), exists, creatable: !exists && fileKind(path) === 'typst' };
  }

  /**
   * Opens `target`, or creates it (empty) and opens it when it is a missing
   * Typst file. Resolves to why that was refused, or null.
   */
  async followDocumentLink(target: LinkTarget): Promise<string | null> {
    if (target.exists) {
      this.workspace.open(target.path);
      return null;
    }
    if (!target.creatable) return `${target.name} is not in the project.`;
    return this.workspace.create(target.path);
  }
}
