import type { PreviewEntry, PreviewViewOption } from '../../hosts/preview/preview';
import type { Extension } from '../../hosts/extension-host/extension-host';

/**
 * Three view options of the preview, off by default:
 * - "Page guides": the borders of the text area, the header, the footer and the column gutters (as LaTeX's showframe)
 * - "Box outlines": every block and box outlined, and every `v(…)` shaded
 * - "Block spacing": the gap between two blocks or paragraphs shaded (slower: it marks every block)
 *
 * They change the preview only; the documents and their PDFs stay as they are. A document's own page background
 * and set rules win over them.
 */
export function previewGuides(): Extension {
  return {
    id: 'preview-guides',
    activate({ preview, subscriptions }) {
      subscriptions.push(preview.registerViewOption(PAGE_GUIDES), preview.registerViewOption(BOX_OUTLINES), preview.registerViewOption(BLOCK_SPACING));
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

/** The bands' look: a translucent teal hatch (`/` for `v(…)`, `\` for the gaps) with thin top and bottom edges. */
const BAND = [
  '#let preview-guides-tiling(from, to) = tiling(size: (4pt, 4pt), {',
  '  place(rect(width: 4pt, height: 4pt, fill: rgb(20, 184, 166, 15%)))',
  '  place(line(start: from, end: to, stroke: 0.5pt + rgb(20, 184, 166, 60%)))',
  '})',
  // a box: rects and lines are blocks, which "Block spacing" would give markers of their own
  '#let preview-guides-band(width, height, fill) = box(width: width, height: height, fill: fill, stroke: (x: none, y: 0.5pt + rgb(20, 184, 166, 80%)))',
];

/**
 * Shades each `v(…)` from where its spacing starts to where it ends, as laid out: a placed marker before it draws a
 * band down to the next end marker after it. Placed content takes no space and Typst's flow looks past it when weak
 * spacing collapses, so the layout stays as it is. Its start is placed, not a tag: tags move past spacing to the next
 * content. The start sits at the flow's right edge, the end at its left one, so the band is as wide as the flow laid
 * out. A tight list, enum or term list starts with a `v` that is kept only right after a paragraph; a marker in front of
 * it would drop it, so that one is left alone (the state is set by the list, cleared by every `v`).
 */
const V_BANDS = [
  ...BAND,
  '#let preview-guides-v-fill = preview-guides-tiling((0pt, 4pt), (4pt, 0pt))',
  '#let preview-guides-v-list = state("preview-guides-v-list", false)',
  '#show list: it => { if it.tight { preview-guides-v-list.update(true) }; it }',
  '#show enum: it => { if it.tight { preview-guides-v-list.update(true) }; it }',
  '#show terms: it => { if it.tight { preview-guides-v-list.update(true) }; it }',
  '#show v: it => {',
  '  context if not preview-guides-v-list.get() {',
  '    place(right, context {',
  '      let start = here().position()',
  '      let ends = query(selector(<preview-guides-v-end>).after(here()))',
  '      let end = if ends != () { ends.first().location().position() }',
  '      // spacing broken across pages is cut at the page end, negative spacing overlaps: no band',
  '      if end != none and end.page == start.page and end.y > start.y { place(dx: end.x - start.x, preview-guides-band(start.x - end.x, end.y - start.y, preview-guides-v-fill)) }',
  '    })',
  '  }',
  '  it',
  '  preview-guides-v-list.update(false)',
  '  place(left)[#metadata(none)<preview-guides-v-end>]',
  '}',
];

const BOX_OUTLINES: PreviewViewOption = {
  id: 'previewGuides.boxOutlines',
  label: 'Box outlines',
  description: 'An outline around every block and box, and each v(…) shaded (in the preview only)',
  default: false,
  apply: (entry, on) =>
    withLines(entry, on, [
      // 1pt is Typst's own default: a document's stroke that names no thickness folds with this one and keeps it
      '#set block(stroke: 1pt + rgb(217, 70, 239, 50%))',
      '#set box(stroke: 1pt + rgb(217, 70, 239, 50%))',
      ...V_BANDS,
    ]),
};

/**
 * Shades the gap between two blocks or paragraphs as laid out, moving nothing: placed content and tags (`metadata`)
 * take no space, and Typst's flow looks past both when weak spacing collapses.
 *
 * Typst collapses one item's `below`, the weak `v`s after it and the next item's `above` into one spacing right after
 * the first item, so no marker can sit at its top. Tags mark each item's top and end (with its spacing below) and each
 * `v`; a placed marker before each item works out the gap above it as the flow does and draws it up from the end tag of
 * the item above, which lands where the next content starts. It draws only when the positions show both items in one
 * flow: that end tag at its own height (less the strong `v`s between), and its own item's top tag there too (else the
 * item moved on to the next page, the marker stayed behind). The tags are labelled by page, so that each marker's
 * queries stay short. Paragraphs get no placed marker after them (it would drop a tight list's spacing). The `v` tags
 * are its own, so it works without "Box outlines", whose `v` bands it leaves alone. Three markers per block and
 * paragraph make long documents compile slower.
 */
const GAPS = [
  ...BAND,
  '#let preview-guides-gap-fill = preview-guides-tiling((0pt, 0pt), (4pt, 4pt))',
  '#let preview-guides-gap-list = state("preview-guides-gap-list", false)',
  '#show list: it => { if it.tight { preview-guides-gap-list.update(true) }; it }',
  '#show enum: it => { if it.tight { preview-guides-gap-list.update(true) }; it }',
  '#show terms: it => { if it.tight { preview-guides-gap-list.update(true) }; it }',
  // in points, with the weakness Typst's flow gives it (the lowest wins, then the largest): 1 weak `v`, 3 set, 4
  // `auto`, paragraphs; none for spacing in fractions or relative to the page
  '#let preview-guides-spacing(amount, weakness) = if type(amount) == length { (amount.to-absolute(), weakness) } else if type(amount) == relative and amount.ratio == 0% { (amount.length.to-absolute(), weakness) }',
  // the tags the gaps are worked out from, labelled by page and kind (an item's end, else a start: an item's top or a
  // `v`), so that the queries of the placed markers stay short
  '#let preview-guides-marks(kind) = selector(label("preview-guides-" + kind + "-" + str(here().page())))',
  '#let preview-guides-mark(kind, ..value) = [#metadata(value.named())#label("preview-guides-" + kind + "-" + str(here().page()))]',
  '#show v: it => {',
  '  context {',
  '    let list = preview-guides-gap-list.get()',
  '    let mark = preview-guides-mark("start", kind: "v", spacing: preview-guides-spacing(it.amount, 1), weak: it.weak, list: list)',
  // placed, so that the end tag of the item above stops before the spacing (tags move past spacing); a tight list's
  // `v` gets a bare tag, as placed content in front of it would drop it
  '    if list { mark } else { place(mark) }',
  '  }',
  '  it',
  '  preview-guides-gap-list.update(false)',
  '}',
  // the gap above an item with the spacing `above`, drawn by its placed marker
  '#let preview-guides-gap(above) = {',
  '  // the item above: the last one to end on this page',
  '  let end = query(preview-guides-marks("end").before(here())).at(-1, default: none)',
  '  if end == none or above == none or end.value.below == none { return }',
  '  let (spacings, strong, attach) = ((end.value.below, above), 0pt, end.value.paragraph)',
  // after that end: the `v`s between, then this marker's own mark and its item's top; another item's mark or top
  // first means an item started since, which this one is the first in
  '  let starts = query(preview-guides-marks("start").after(end.location()))',
  '  let at = starts.position(start => start.value.kind == "item")',
  '  if at == none { return }',
  '  for start in starts.slice(0, at).map(start => start.value) {',
  '    if start.kind != "v" { return }',
  '    // a tight list\'s spacing is dropped unless right after a paragraph; fractions take the weak spacing away',
  '    if start.list and not attach { } else if start.spacing == none { return } else if start.weak or start.list { spacings.push(start.spacing) } else { strong += start.spacing.first() }',
  '    attach = false',
  '  }',
  '  let gap = spacings.sorted(key: ((amount, weakness)) => (weakness, -amount)).first().first()',
  '  let top = starts.at(at + 1, default: none)',
  '  if starts.at(at).value.at != here() or top == none or top.value.kind != "top" or gap <= 0pt { return }',
  '  // the marker sits at the flow\'s right edge, the tags at its left one',
  '  let (here, end, top) = (here().position(), end.location().position(), top.location().position())',
  '  let level(a, b) = a.page == b.page and calc.abs(a.y - b.y) < 0.01pt',
  '  if level(here, top) and level(here, (..end, y: end.y + strong)) and calc.abs(end.x - top.x) < 0.01pt {',
  '    place(dx: end.x - here.x, dy: end.y - gap - here.y, preview-guides-band(here.x - end.x, gap, preview-guides-gap-fill))',
  '  }',
  '}',
  '#let preview-guides-item(it, above, below, paragraph) = {',
  // at the right: the flow's width as laid out, also where a figure's or box's flow is narrower than the page's
  '  place(right, context { preview-guides-mark("start", kind: "item", at: here()); preview-guides-gap(above()) })',
  '  context preview-guides-mark("start", kind: "top")',
  '  it',
  '  context preview-guides-mark("end", below: below(), paragraph: paragraph)',
  '}',
  '#let preview-guides-block-spacing(amount) = if amount == auto { preview-guides-spacing(par.spacing, 4) } else { preview-guides-spacing(amount, 3) }',
  '#show block: it => preview-guides-item(it, () => preview-guides-block-spacing(it.above), () => preview-guides-block-spacing(it.below), false)',
  '#show par: it => preview-guides-item(it, () => preview-guides-spacing(par.spacing, 4), () => preview-guides-spacing(par.spacing, 4), true)',
];

const BLOCK_SPACING: PreviewViewOption = {
  id: 'previewGuides.blockSpacing',
  label: 'Block spacing',
  description: 'The gaps between blocks and paragraphs shaded as laid out; slows the preview of long documents (in the preview only)',
  default: false,
  apply: (entry, on) => withLines(entry, on, GAPS),
};

/** `entry` with `lines` added to its prelude while the option is `on`. */
function withLines(entry: PreviewEntry, on: boolean, lines: readonly string[]): PreviewEntry {
  return on ? { ...entry, prelude: [...entry.prelude, ...lines] } : entry;
}
