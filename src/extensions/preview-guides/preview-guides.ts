import type { PreviewEntry, PreviewViewOption } from '../../hosts/preview/preview';
import type { TypstExtension } from '../../hosts/workbench/workbench';

/**
 * Page guides and box outlines in the preview: two view options (the preview toolbar's View menu), off by default.
 *
 * "Page guides" draws the borders of the text area, the header and the footer (and the column gutters) with
 * `@preview/scaffolder`, as LaTeX's showframe does. The guides go into the page background; a document that sets
 * a background of its own keeps it, and the guides move to the foreground (one sets both: no guides). "Box outlines"
 * outlines every block and box (headings, figures, lists, equations, `#block`, `#box`) by set rules, so what a
 * document sets itself wins. Typst draws the outline around the inset, widened by the outset; the inset and the
 * spacing around a block are not drawn on their own (docs/30_architecture/08_built-in-extensions.typ says why).
 *
 * Both are Typst run before the main file in the preview only (`PreviewViewOption`); the documents and their PDFs
 * stay as they are. The colors are mid-tones, readable on the inverted pages of the dark mode too. The pictures of
 * raw boxes are cut from the preview's pages, so they show the guides and outlines as well.
 */
export function previewGuides(): TypstExtension {
  return {
    id: 'preview-guides',
    activate({ preview, subscriptions }) {
      subscriptions.push(preview.registerViewOption(PAGE_GUIDES), preview.registerViewOption(BOX_OUTLINES));
    },
  };
}

/** The package drawing the page guides (`mise run build:packages` downloads it for the unit tests). */
const SCAFFOLDER = '@preview/scaffolder:0.2.1';

const PAGE_GUIDES: PreviewViewOption = {
  id: 'previewGuides.pageGuides',
  label: 'Page guides',
  description: 'Borders of the text area, header and footer (in the preview only)',
  default: false,
  apply: (entry) => withLines(entry, [
    `#import "${SCAFFOLDER}": scaffolding as preview-guides-scaffolding`,
    '#let preview-guides-page = preview-guides-scaffolding(stroke: (paint: rgb("#3b82f6"), thickness: 0.5pt, dash: "densely-dashed"))',
    // in the background; in the foreground once the document replaced the background with its own
    '#set page(background: preview-guides-page, foreground: context if page.background != preview-guides-page { preview-guides-page })',
  ]),
};

const BOX_OUTLINES: PreviewViewOption = {
  id: 'previewGuides.boxOutlines',
  label: 'Box outlines',
  description: 'An outline around every block and box (in the preview only)',
  default: false,
  // 1pt is Typst's own default: a document's stroke that names no thickness folds with this one and keeps it
  apply: (entry) => withLines(entry, ['#set block(stroke: 1pt + rgb(217, 70, 239, 50%))', '#set box(stroke: 1pt + rgb(217, 70, 239, 50%))']),
};

function withLines(entry: PreviewEntry, lines: readonly string[]): PreviewEntry {
  return { ...entry, prelude: [...entry.prelude, ...lines] };
}
