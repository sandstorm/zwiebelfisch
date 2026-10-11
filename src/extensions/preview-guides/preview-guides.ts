import type { PreviewEntry, PreviewViewOption } from '../../hosts/preview/preview';
import type { TypstExtension } from '../../hosts/workbench/workbench';

/**
 * Page guides and box outlines in the preview: two view options (in the View menu), off by default.
 *
 * "Page guides" draws the borders of the text area, the header and the footer (and the column gutters), as
 * LaTeX's showframe does. The guides go into the page background; a document that sets
 * a background of its own keeps it, and the guides move to the foreground (one sets both: no guides). "Box outlines"
 * outlines every block and box (headings, figures, lists, equations, `#block`, `#box`) by set rules, so what a
 * document sets itself wins. Typst draws the outline around the inset, widened by the outset; the inset and the
 * spacing around a block are not drawn on their own. It also shades every `v(…)` as Typst laid it out (`1fr` too),
 * between two placed markers that take no space; weak spacing that collapsed into a paragraph's or block's spacing
 * shows nothing. docs/30_architecture/08_built-in-extensions.typ says why and what is left out (`h`).
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

/**
 * `preview-guides-page`: the guides of the page it is the background (or foreground) of, read from the page's settings
 * as Typst lays the page out. It is total over them: whatever a document sets, it draws lines and never fails (an
 * error here would be the preview's). The page's size is the one laid out, so `width: auto`, `height: auto` and
 * flipped pages need nothing of their own; margins left `auto` are Typst's default, 2.5/21 of the shorter fixed side.
 */
const GUIDES = [
  '#let preview-guides-page = layout(size => {',
  '  let stroke = (paint: rgb("#3b82f6"), thickness: 0.5pt, dash: "densely-dashed")',
  '  // a length, ratio or relative length in points, its ratio taken of `base`; anything else 0pt',
  '  let resolve(value, base) = if type(value) == length { value.to-absolute() } else if type(value) == ratio { value * base } else if type(value) == relative { value.ratio * base + value.length.to-absolute() } else { 0pt }',
  '  let fixed = (page.width, page.height).filter(side => type(side) == length).map(side => side.to-absolute())',
  '  let default = 2.5 / 21 * if fixed == () { 210mm } else { calc.min(..fixed) }',
  '  let margin = if type(page.margin) == dictionary { page.margin } else { (top: page.margin, bottom: page.margin, left: page.margin, right: page.margin) }',
  '  let side(key, base) = { let value = margin.at(key, default: auto); if value == auto { default } else { resolve(value, base) } }',
  '  let (margin-top, margin-bottom) = (side("top", size.height), side("bottom", size.height))',
  '  let (margin-left, margin-right) = (side("left", size.width), side("right", size.width))',
  '  if "inside" in margin or "outside" in margin {',
  "    // two-sided: the inside is on the left of odd pages for a left binding (by default the text direction's)",
  '    let rtl-text = text.dir == rtl or (text.dir == auto and text.lang in ("ar", "dv", "fa", "he", "ks", "pa", "ps", "sd", "ug", "ur", "yi"))',
  '    let binding = if page.binding == auto { if rtl-text { right } else { left } } else { page.binding }',
  '    (margin-left, margin-right) = (side("inside", size.width), side("outside", size.width))',
  '    if calc.even(here().page()) == (binding == left) { (margin-left, margin-right) = (margin-right, margin-left) }',
  '  }',
  '  let across(y) = place(top + left, dy: y, line(length: size.width, stroke: stroke))',
  '  let down(x) = place(top + left, dx: x, line(angle: 90deg, length: size.height, stroke: stroke))',
  '  let width = size.width - margin-left - margin-right',
  '  let gutter = resolve(columns.gutter, width)',
  '  let column = (width - (page.columns - 1) * gutter) / page.columns',
  '  block(width: size.width, height: size.height, {',
  "    // the text area, the header's bottom and the footer's top (ascent and descent are relative to the margin)",
  '    down(margin-left)',
  '    down(size.width - margin-right)',
  '    across(margin-top)',
  '    across(size.height - margin-bottom)',
  '    across(margin-top - resolve(page.header-ascent, margin-top))',
  '    across(size.height - margin-bottom + resolve(page.footer-descent, margin-bottom))',
  '    for i in range(1, page.columns) {',
  '      down(margin-left + i * column + (i - 1) * gutter)',
  '      down(margin-left + i * (column + gutter))',
  '    }',
  '  })',
  '})',
];

const PAGE_GUIDES: PreviewViewOption = {
  id: 'previewGuides.pageGuides',
  label: 'Page guides',
  description: 'Borders of the text area, header and footer (in the preview only)',
  default: false,
  apply: (entry, on) =>
    withLines(entry, on, [
      ...GUIDES,
      // in the background; in the foreground once the document replaced the background with its own
      '#set page(background: preview-guides-page, foreground: context if page.background != preview-guides-page { preview-guides-page })',
    ]),
};

/**
 * Shades each `v(…)` from where its spacing starts to where it ends, as laid out: a placed marker before it draws a
 * band down to the next end marker after it. Placed content takes no space and Typst's flow looks past it when weak
 * spacing collapses, so the layout stays as it is. Its start is placed, not a tag: tags move past spacing to the next
 * content. A tight list, enum or term list starts with a `v` that is kept only right after a paragraph; a marker in
 * front of it would drop it, so that one is left alone (the state is set by the list, cleared by every `v`).
 */
const SPACING = [
  '#let preview-guides-hatch = tiling(size: (4pt, 4pt), {',
  '  place(rect(width: 4pt, height: 4pt, fill: rgb(20, 184, 166, 15%)))',
  '  place(line(start: (0pt, 4pt), end: (4pt, 0pt), stroke: 0.5pt + rgb(20, 184, 166, 60%)))',
  '})',
  '#let preview-guides-list = state("preview-guides-list", false)',
  '#show list: it => { if it.tight { preview-guides-list.update(true) }; it }',
  '#show enum: it => { if it.tight { preview-guides-list.update(true) }; it }',
  '#show terms: it => { if it.tight { preview-guides-list.update(true) }; it }',
  '#show v: it => {',
  '  context if not preview-guides-list.get() {',
  '    place(context {',
  '      let start = here().position()',
  '      let ends = query(selector(<preview-guides-v-end>).after(here()))',
  '      let end = if ends != () { ends.first().location().position() }',
  '      // spacing broken across pages is cut at the page end, negative spacing overlaps: no band',
  '      if end != none and end.page == start.page and end.y > start.y {',
  '        set block(stroke: none)',
  '        rect(width: 100%, height: end.y - start.y, fill: preview-guides-hatch, stroke: (y: 0.5pt + rgb(20, 184, 166, 80%)))',
  '      }',
  '    })',
  '  }',
  '  it',
  '  preview-guides-list.update(false)',
  '  place[#metadata(none)<preview-guides-v-end>]',
  '}',
];

const BOX_OUTLINES: PreviewViewOption = {
  id: 'previewGuides.boxOutlines',
  label: 'Box outlines',
  description: 'An outline around every block and box, and the vertical spacing shaded (in the preview only)',
  default: false,
  apply: (entry, on) =>
    withLines(entry, on, [
      // 1pt is Typst's own default: a document's stroke that names no thickness folds with this one and keeps it
      '#set block(stroke: 1pt + rgb(217, 70, 239, 50%))',
      '#set box(stroke: 1pt + rgb(217, 70, 239, 50%))',
      ...SPACING,
    ]),
};

/** `entry` with `lines` added to its prelude while the option is `on`. */
function withLines(entry: PreviewEntry, on: boolean, lines: readonly string[]): PreviewEntry {
  return on ? { ...entry, prelude: [...entry.prelude, ...lines] } : entry;
}
