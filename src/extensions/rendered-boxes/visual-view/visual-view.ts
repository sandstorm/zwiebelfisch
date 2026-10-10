// Rendered boxes in the Visual view: raw boxes show the compiled snippet of their source while they are not
// edited. See ../rendered-boxes.ts and ARCHITECTURE.md, "VisualView".
import type { BoxRenderer } from '../../../hosts/visual-view/visual-view';
import type { SnippetSource } from '../rendered-boxes';
import { rendersInPlace, snippetSize } from '../model/model';

/** The box renderer drawing raw boxes as `source`'s snippets (see `renderedBoxesVisualView`). */
export function snippetRenderer(source: SnippetSource | undefined): BoxRenderer | null {
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
