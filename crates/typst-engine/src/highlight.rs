//! Geometry of text in a laid-out document: which source span is under a
//! point, and where all glyphs of a span are drawn (for highlighting).

use std::collections::HashSet;

use typst::foundations::{Content, StyleChain};
use typst::introspection::{Location, Tag};
use typst::layout::{Abs, Frame, FrameItem, Point, Transform};
use typst::model::{CiteGroup, EnumElem, ListElem, ParElem, TermsElem};
use typst::pdf::{ArtifactElem, ArtifactKind};
use typst::syntax::Span;
use typst::text::TextItem;
use typst_layout::PagedDocument;

/// An axis-aligned rectangle on a page, in points from the top-left corner.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PageBox {
    pub page: usize,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// The span of the glyph under `point` on `frame` (a page), if any.
pub fn span_at(frame: &Frame, point: Point) -> Option<Span> {
    let mut found = None;
    walk_text(frame, Transform::identity(), &mut |ts, pos, text| {
        for ((glyph, _), rect) in glyph_rects(ts, pos, text) {
            if !glyph.is_detached() && rect.contains(point) {
                found = Some(glyph);
            }
        }
    });
    found
}

/// One box per contiguous run of glyphs from `span`, on every page — e.g. one
/// per line for a sentence that wraps.
pub fn span_boxes(document: &PagedDocument, span: Span) -> Vec<PageBox> {
    glyph_boxes(document, |glyph, _| glyph == span)
}

/// One box per contiguous run of glyphs for which `keep(span, offset)` holds,
/// on every page; `offset` is the glyph's byte offset within its span's text.
pub fn glyph_boxes(document: &PagedDocument, keep: impl FnMut(Span, u16) -> bool) -> Vec<PageBox> {
    boxes(document, false, keep, |_| false)
}

/// Like `glyph_boxes`, but shapes (rules, fraction lines, rectangles) and
/// images count, too: each one whose span passes `keep(span, 0)` is a box of
/// its own. And everything drawn inside an element whose span passes
/// `whole(span)` counts, whatever its own span: a figure's picture that a
/// package draws carries the package's spans, but sits between the start and
/// end tag of the figure (Typst tags locatable and tagged elements).
pub fn drawn_boxes(
    document: &PagedDocument,
    keep: impl FnMut(Span, u16) -> bool,
    whole: impl FnMut(Span) -> bool,
) -> Vec<PageBox> {
    boxes(document, true, keep, whole)
}

fn boxes(
    document: &PagedDocument,
    graphics: bool,
    mut keep: impl FnMut(Span, u16) -> bool,
    mut whole: impl FnMut(Span) -> bool,
) -> Vec<PageBox> {
    let mut boxes = Vec::new();
    let mut open = OpenElements::default();
    for (page, p) in document.pages().iter().enumerate() {
        walk_items(&p.frame, Transform::identity(), &mut |ts, pos, item| match item {
            FrameItem::Tag(Tag::Start(elem, _)) => open.start(elem, &mut whole),
            FrameItem::Tag(Tag::End(location, ..)) => open.end(*location),
            FrameItem::Text(text) => {
                let inside = open.any();
                let mut run: Option<Rect> = None;
                for ((glyph, offset), rect) in glyph_rects(ts, pos, text) {
                    if inside || keep(glyph, offset) {
                        run = Some(run.map_or(rect, |r| r.union(rect)));
                    } else if let Some(r) = run.take() {
                        boxes.push(r.on_page(page));
                    }
                }
                if let Some(r) = run {
                    boxes.push(r.on_page(page));
                }
            }
            FrameItem::Shape(shape, span) if graphics && (open.any() || keep(*span, 0)) => {
                let bbox = shape.bbox(true);
                boxes.push(Rect::transformed(ts, pos + bbox.min, pos + bbox.max).on_page(page));
            }
            FrameItem::Image(_, size, span) if graphics && (open.any() || keep(*span, 0)) => {
                boxes.push(Rect::transformed(ts, pos, pos + size.to_point()).on_page(page));
            }
            _ => {}
        });
    }
    boxes
}

/// The elements passing `whole` that are open at the current item, as the
/// tags of the pages come in document order: an element may end on a later
/// page. A page's header, footer and background never count for an element
/// opened in its body (one that breaks across the page is open meanwhile):
/// inside one, only elements opened there count.
#[derive(Default)]
struct OpenElements {
    open: HashSet<Location>,
    /// Per marginal entered: its location and the elements open outside it.
    marginals: Vec<(Location, HashSet<Location>)>,
}

impl OpenElements {
    fn start(&mut self, elem: &Content, whole: &mut impl FnMut(Span) -> bool) {
        let Some(location) = elem.location() else { return };
        if is_marginal(elem) {
            self.marginals.push((location, std::mem::take(&mut self.open)));
        } else if !is_grouping(elem) && whole(elem.span()) {
            self.open.insert(location);
        }
    }

    fn end(&mut self, location: Location) {
        if self.marginals.last().is_some_and(|(marginal, _)| *marginal == location) {
            self.open = self.marginals.pop().map(|(_, outside)| outside).unwrap_or_default();
        } else {
            self.open.remove(&location);
        }
    }

    fn any(&self) -> bool {
        !self.open.is_empty()
    }
}

/// Whether `elem` is a page's header, footer or background: Typst lays them
/// out as artifacts of these kinds (typst-layout's `pages/run.rs`). A page's
/// foreground is no artifact, so it is not recognized.
fn is_marginal(elem: &Content) -> bool {
    elem.to_packed::<ArtifactElem>().is_some_and(|artifact| {
        let kind = artifact.kind.get(StyleChain::default());
        matches!(kind, ArtifactKind::Header | ArtifactKind::Footer | ArtifactKind::Background)
    })
}

/// Whether realization made `elem` from a run of siblings (a paragraph, a
/// list) and gave it the span of the first one, so that its span says nothing
/// about where the rest comes from.
fn is_grouping(elem: &Content) -> bool {
    elem.is::<ParElem>()
        || elem.is::<ListElem>()
        || elem.is::<EnumElem>()
        || elem.is::<TermsElem>()
        || elem.is::<CiteGroup>()
}

#[derive(Debug, Clone, Copy)]
struct Rect {
    min: Point,
    max: Point,
}

impl Rect {
    /// The axis-aligned bounds of the local rectangle `min..max` under `ts`.
    fn transformed(ts: Transform, min: Point, max: Point) -> Rect {
        let corners = [min, Point::new(max.x, min.y), Point::new(min.x, max.y), max].map(|p| p.transform(ts));
        let (mut lo, mut hi) = (corners[0], corners[0]);
        for c in &corners[1..] {
            lo = Point::new(lo.x.min(c.x), lo.y.min(c.y));
            hi = Point::new(hi.x.max(c.x), hi.y.max(c.y));
        }
        Rect { min: lo, max: hi }
    }

    fn contains(&self, p: Point) -> bool {
        self.min.x <= p.x && p.x <= self.max.x && self.min.y <= p.y && p.y <= self.max.y
    }

    fn union(self, other: Rect) -> Rect {
        Rect {
            min: Point::new(self.min.x.min(other.min.x), self.min.y.min(other.min.y)),
            max: Point::new(self.max.x.max(other.max.x), self.max.y.max(other.max.y)),
        }
    }

    fn on_page(self, page: usize) -> PageBox {
        PageBox {
            page,
            x: self.min.x.to_pt(),
            y: self.min.y.to_pt(),
            w: (self.max.x - self.min.x).to_pt(),
            h: (self.max.y - self.min.y).to_pt(),
        }
    }
}

/// Each glyph's span and offset in it, with its page-space box (advance width × ascender..descender).
fn glyph_rects(ts: Transform, pos: Point, text: &TextItem) -> Vec<((Span, u16), Rect)> {
    let metrics = text.font.metrics();
    let top = pos.y - metrics.ascender.at(text.size);
    let bottom = pos.y - metrics.descender.at(text.size);
    let mut x = pos.x;
    text.glyphs
        .iter()
        .map(|glyph| {
            let advance = glyph.x_advance.at(text.size);
            let rect = Rect::transformed(ts, Point::new(x, top), Point::new(x + advance.max(Abs::zero()), bottom));
            x += advance;
            (glyph.span, rect)
        })
        .collect()
}

fn walk_text(frame: &Frame, ts: Transform, f: &mut impl FnMut(Transform, Point, &TextItem)) {
    walk_items(frame, ts, &mut |ts, pos, item| {
        if let FrameItem::Text(text) = item {
            f(ts, pos, text);
        }
    });
}

/// Calls `f` with every non-group item, its position and the transform of its frame.
fn walk_items(frame: &Frame, ts: Transform, f: &mut impl FnMut(Transform, Point, &FrameItem)) {
    for (pos, item) in frame.items() {
        match item {
            FrameItem::Group(group) => {
                let inner = ts.pre_concat(Transform::translate(pos.x, pos.y)).pre_concat(group.transform);
                walk_items(&group.frame, inner, f);
            }
            item => f(ts, *pos, item),
        }
    }
}
