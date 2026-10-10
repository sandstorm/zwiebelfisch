// Rendered boxes: raw boxes show the compiled snippet of their source (from the preview) while they are not
// edited. Entry of visual-view/builtins/rendered-boxes/. See ARCHITECTURE.md, "VisualView".
import type { Event } from '../../../../core/event-emitter/event-emitter';
import type { TypstDocument } from '../../../../core/typst-document/typst-document';
import type { BoxPicture, BoxRenderer, VisualViewContribution } from '../../contributions/contributions';

/** A picture of compiled Typst: standalone SVG markup and its size in points. */
export interface Snippet {
  svg: string;
  width: number;
  height: number;
  /** Height (pt) of one line of its biggest text; without it, inline boxes show the snippet at its own size. */
  textHeight?: number;
  /** Space (pt) around what is drawn. */
  padding?: number;
}

/** Where snippets come from: the host's compiled pages. */
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
export function renderedBoxes(options: RenderedBoxesOptions = {}): VisualViewContribution {
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

/** How tall a line of text is (ascender to descender, as the engine boxes glyph runs), in em of its size. */
const TEXT_LINE_EM = 1.15;

/**
 * How an inline box draws its snippet, in em of the text around it: scaled so
 * the snippet's text (`textHeight`) is as big as that text, and with negative
 * vertical margins taking back the padding, so a one-line snippet takes one
 * line (1.15em) and does not make its line taller. Null without a text height.
 */
export function inlinePictureSize({ height, textHeight, padding = 0 }: Pick<Snippet, 'height' | 'textHeight' | 'padding'>): { height: number; margin: number } | null {
  if (!textHeight) return null;
  const emPerPt = TEXT_LINE_EM / textHeight;
  return { height: height * emPerPt, margin: -padding * emPerPt };
}

/** Code that configures or defines (`#set`, `#let`, …) and draws nothing in place, or only elsewhere. */
const NOT_IN_PLACE = /^\s*(#(set|show|let|import|include)\b|\/\/|\/\*)/;

/** Whether `src` (a raw box's Typst) draws its own output where it stands, so a snippet of it is meaningful. */
export function rendersInPlace(src: string): boolean {
  return !NOT_IN_PLACE.test(src);
}

/** A snippet at its own size (pt), or inline in the line of text around it (em, see `inlinePictureSize`). */
function snippetSize(snippet: Snippet, inline: boolean): Omit<BoxPicture, 'url'> {
  const em = inline ? inlinePictureSize(snippet) : null;
  if (!em) return { width: `${snippet.width}pt`, height: '', margin: '' };
  return { width: '', height: `${em.height}em`, margin: `${em.margin}em` };
}
