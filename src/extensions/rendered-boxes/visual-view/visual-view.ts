// Rendered boxes in the Visual view: raw boxes show the compiled snippet of their source while they are not
// edited. Entry of extensions/rendered-boxes/visual-view/. See ../rendered-boxes.ts and ARCHITECTURE.md, "VisualView".
import type { Event } from '../../../core/event-emitter/event-emitter';
import type { TypstDocument } from '../../../core/typst-document/typst-document';
import type { BoxRenderer, VisualViewContribution } from '../../../hosts/visual-view/visual-view';
import { rendersInPlace, snippetSize, type Snippet } from '../model/model';

/** Where a document's snippets come from: the compiled pages. */
export interface SnippetSource {
  /**
   * How source `from`..`to` of the document, which holds `text`, looks
   * compiled; null when it draws nothing or cannot be shown right now.
   */
  snippet(from: number, to: number, text: string): Promise<Snippet | null>;
  /** Fires whenever snippets may have changed. */
  readonly onDidChange: Event<void>;
}

export interface RenderedBoxesOptions {
  /** The snippets of `document` (default: none, boxes show their code). */
  snippets?(document: TypstDocument): SnippetSource | undefined;
}

/**
 * While not focused, a raw box shows the compiled snippet of its source range
 * as an SVG picture, refreshed whenever the source reports a change. Block
 * boxes size it in pt; inline boxes in em of the text around them (see
 * `inlinePictureSize`). Boxes that draw nothing in place (`#set`, `#let`,
 * comments: see `rendersInPlace`) and boxes whose snippet is null keep
 * showing code. Registered after `images`, whose renderer draws image boxes.
 */
export function renderedBoxesVisualView(options: RenderedBoxesOptions = {}): VisualViewContribution {
  return {
    id: 'rendered-boxes',
    activate({ visualView, subscriptions }) {
      subscriptions.push(visualView.registerBoxRenderer((view) => snippetRenderer(options.snippets?.(view.document))));
    },
  };
}

function snippetRenderer(source: SnippetSource | undefined): BoxRenderer | null {
  if (!source) return null;
  return {
    renders: () => true,
    render: async (node, from) => {
      const src: string = node.attrs.src;
      if (!rendersInPlace(src)) return null;
      const snippet = await source.snippet(from, from + src.length, src);
      return snippet && { url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(snippet.svg)}`, ...snippetSize(snippet, node.isInline) };
    },
    onDidChange: source.onDidChange,
  };
}
