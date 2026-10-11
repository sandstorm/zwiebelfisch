// The rendered-boxes model: which raw boxes a snippet is meaningful for, and how big a snippet is drawn. No DOM.
// See ../rendered-boxes.ts.
import type { Pt } from '../../../core/typst-engine/typst-engine';

/** Whether `src` (a raw box's Typst) draws its own output where it stands, so a snippet of it is meaningful. */
export function rendersInPlace(src: string): boolean {
  return !NOT_IN_PLACE.test(src);
}

/** A picture of compiled Typst: standalone SVG markup and its size. */
export interface RenderedSnippet {
  svg: string;
  width: Pt;
  height: Pt;
  /** Height of one line of its biggest text; without it, inline boxes show the snippet at its own size. */
  textHeight?: Pt;
  /** Space around what is drawn. */
  padding?: Pt;
}

/** A snippet at its own size (pt), or inline in the line of text around it (em, see `inlinePictureSize`), as CSS lengths. */
export function snippetSize(snippet: RenderedSnippet, inline: boolean): { width: string; height: string; margin: string } {
  const em = inline ? inlinePictureSize(snippet) : null;
  if (!em) return { width: `${snippet.width}pt`, height: '', margin: '' };
  return { width: '', height: `${em.height}em`, margin: `${em.margin}em` };
}

/**
 * How an inline box draws its snippet, in em of the text around it: scaled so
 * the snippet's text (`textHeight`) is as big as that text, and with negative
 * vertical margins taking back the padding, so a one-line snippet takes one
 * line (1.15em) and does not make its line taller. Null without a text height.
 */
export function inlinePictureSize({ height, textHeight, padding }: Pick<RenderedSnippet, 'height' | 'textHeight' | 'padding'>): { height: number; margin: number } | null {
  if (!textHeight) return null;
  const emPerPt = TEXT_LINE_EM / textHeight;
  return { height: height * emPerPt, margin: -(padding ?? 0) * emPerPt };
}

/** Code that configures or defines (`#set`, `#let`, …) and draws nothing in place, or only elsewhere. */
const NOT_IN_PLACE = /^\s*(#(set|show|let|import|include)\b|\/\/|\/\*)/;

/** How tall a line of text is (ascender to descender, as the engine boxes glyph runs), in em of its size. */
const TEXT_LINE_EM = 1.15;
