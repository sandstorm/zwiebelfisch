//! Geometry of text in a laid-out document: which source span is under a
//! point, and where all glyphs of a span are drawn (for highlighting).

use typst::layout::{Abs, Frame, FrameItem, Point, Transform};
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
        for (glyph, rect) in glyph_rects(ts, pos, text) {
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
    let mut boxes = Vec::new();
    for (page, p) in document.pages().iter().enumerate() {
        walk_text(&p.frame, Transform::identity(), &mut |ts, pos, text| {
            let mut run: Option<Rect> = None;
            for (glyph, rect) in glyph_rects(ts, pos, text) {
                if glyph == span {
                    run = Some(run.map_or(rect, |r| r.union(rect)));
                } else if let Some(r) = run.take() {
                    boxes.push(r.on_page(page));
                }
            }
            if let Some(r) = run {
                boxes.push(r.on_page(page));
            }
        });
    }
    boxes
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

/// Each glyph's span with its page-space box (advance width × ascender..descender).
fn glyph_rects(ts: Transform, pos: Point, text: &TextItem) -> Vec<(Span, Rect)> {
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
            (glyph.span.0, rect)
        })
        .collect()
}

fn walk_text(frame: &Frame, ts: Transform, f: &mut impl FnMut(Transform, Point, &TextItem)) {
    for (pos, item) in frame.items() {
        match item {
            FrameItem::Group(group) => {
                let inner = ts.pre_concat(Transform::translate(pos.x, pos.y)).pre_concat(group.transform);
                walk_text(&group.frame, inner, f);
            }
            FrameItem::Text(text) => f(ts, *pos, text),
            _ => {}
        }
    }
}
