// Rendered boxes in the Visual editor: raw boxes show the compiled snippet of their source while they are not
// edited. See renderedBoxes in ../rendered-boxes.ts.
import type { Event } from '../../../core/event-emitter/event-emitter';
import { SourceRange } from '../../../core/typst-document/typst-document';
import type { RawBoxRenderer } from '../../../hosts/visual-editor/visual-editor';
import { rendersInPlace, snippetSize, type RenderedSnippet } from '../model/model';

/**
 * The box renderer drawing raw boxes as `source`'s snippets: while not focused, a raw box shows the compiled snippet
 * of its source range as an SVG picture, refreshed whenever the source reports a change. Block boxes size it in pt;
 * inline boxes in em of the text around them (see `inlinePictureSize`). Boxes that draw nothing in place (`#set`,
 * `#let`, comments: see `rendersInPlace`) and boxes whose snippet is null keep showing code.
 */
export function snippetRenderer(source: SnippetSource): RawBoxRenderer {
  return {
    className: 'zwf-rendered-boxes__snippet',
    renders: () => true,
    render: async (node, from) => {
      const src: string = node.attrs.src;
      if (!rendersInPlace(src)) return null;
      const snippet = await source.snippet(SourceRange.of({ from, to: from + src.length }), src);
      return snippet && { url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(snippet.svg)}`, ...snippetSize(snippet, node.isInline) };
    },
    onDidChange: source.onDidChange,
  };
}

/** Where a document's snippets come from: the compiled pages. */
export interface SnippetSource {
  /**
   * How source range `range` of the document, which holds `text`, looks
   * compiled; null when it draws nothing or cannot be shown right now.
   */
  snippet(range: SourceRange, text: string): Promise<RenderedSnippet | null>;
  /** Fires whenever snippets may have changed. */
  readonly onDidChange: Event<void>;
}
