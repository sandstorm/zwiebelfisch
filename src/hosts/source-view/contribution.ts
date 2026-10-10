// What a contribution to the Source view is, and what it learns about the view it is applied to.
// A leaf (imports nothing of its folder), so contributions can name these types without importing the host.
// See source-view.ts.
import type { Extension } from '@codemirror/state';
import type { DocumentLinkProvider } from '../../core/document-links/document-links';
import type { TypstDocument } from '../../core/typst-document/typst-document';

/**
 * CodeMirror extensions for every Source view: the same value for all of them, or made per view from
 * what the view shows (`SourceViewContext`).
 */
export type SourceViewExtension = Extension | ((view: SourceViewContext) => Extension);

/** What a contribution knows about the one Source view it is applied to. */
export interface SourceViewContext {
  /** The document the view edits. */
  readonly document: TypstDocument;
  /** Where the file paths in the document lead (from the registered link providers); null: nowhere. */
  readonly documentLinks: DocumentLinkProvider | null;
}

/** Gives the Source views of `document` the links of its file paths; null when it has none. */
export type LinkProviderFactory = (document: TypstDocument) => DocumentLinkProvider | null;
