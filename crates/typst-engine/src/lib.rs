//! Typst compiler, SVG renderer, PDF export and source <-> preview
//! hit-testing, packaged for the browser.
//!
//! The JS-facing contract:
//! - Paths are absolute project paths such as `/main.typ`, or package paths
//!   such as `@preview/name:0.1.0/lib.typ`.
//! - Text offsets are **UTF-16 code units** (what CodeMirror and ProseMirror
//!   use); the UTF-8 byte offsets Typst works with never leave this crate.
//! - Pages are 0-based; coordinates are typographic points from the page's
//!   top-left corner.
//! - Structured results are returned as JSON strings (see the `*Json` types)
//!   so the boundary needs no serde glue on the JS side.
//! - A panic aborts (the wasm traps) and leaves the module unusable: every
//!   later call fails. `onPanic` tells JS the panic's message first.

mod highlight;
mod world;

use std::collections::HashMap;
use std::num::NonZeroUsize;
use std::ops::Range;

use serde::Serialize;
use typst::diag::{Severity, SourceDiagnostic};
use typst::layout::{Abs, Point};
use typst_layout::PagedDocument;
use typst::introspection::PagedPosition;
use typst::syntax::{FileId, LinkedNode, Side, Source, Span, SyntaxKind};
use typst::utils::hash128;
use typst::{World, WorldExt};
use typst_ide::Jump;
use wasm_bindgen::prelude::*;

use world::{describe_font, file_id, file_path, FaceInfo, FontLoader, MemoryWorld};

#[wasm_bindgen]
pub struct Engine {
    world: MemoryWorld,
    document: Option<PagedDocument>,
    /// SVGs of the pages of the last compilation, keyed by frame hash, so
    /// unchanged pages are not re-exported.
    svg_cache: HashMap<u128, String>,
}

/// The faces of a font file as `FaceInfo[]` JSON (empty if `data` is not a
/// font): what `Engine::addLazyFont` needs before the data.
#[wasm_bindgen(js_name = describeFont)]
pub fn describe_font_json(data: &[u8]) -> String {
    to_json(&describe_font(data))
}

#[wasm_bindgen]
extern "C" {
    /// A JS object told about a panic (`createEngine` in typst-engine.ts
    /// passes one).
    pub type PanicListener;

    /// Called with the panic's message and where it was raised (`capacity
    /// overflow (at ecow-0.2.6/src/vec.rs:1227)`), before the wasm traps.
    #[wasm_bindgen(method)]
    fn panicked(this: &PanicListener, message: &str);
}

thread_local! {
    static PANIC_LISTENER: std::cell::RefCell<Option<PanicListener>> = const { std::cell::RefCell::new(None) };
}

/// Makes `listener` the one told about a panic (replacing the one before).
/// Without one, a panic's message is lost: Rust's stderr goes nowhere here.
#[wasm_bindgen(js_name = onPanic)]
pub fn on_panic(listener: PanicListener) {
    PANIC_LISTENER.with(|cell| *cell.borrow_mut() = Some(listener));
    std::panic::set_hook(Box::new(|info| {
        let payload = info.payload_as_str().unwrap_or("panic");
        let message = match info.location() {
            Some(location) => format!("{payload} (at {}:{})", crate_path(location.file()), location.line()),
            None => payload.to_string(),
        };
        PANIC_LISTENER.with(|cell| {
            if let Ok(listener) = cell.try_borrow()
                && let Some(listener) = listener.as_ref()
            {
                listener.panicked(&message);
            }
        });
    }));
}

/// `ecow-0.2.6/src/vec.rs` for a file of a crate from the registry: not where
/// the build machine keeps it.
fn crate_path(file: &str) -> &str {
    file.split_once("/registry/src/")
        .and_then(|(_, rest)| rest.split_once('/'))
        .map_or(file, |(_, path)| path)
}

/// How many compilations a memoized result survives unused: `compile` and
/// `exportPdf` evict the older ones, as `typst watch` does after each
/// compilation. Typst memoizes (comemo) in a global cache that only `evict`
/// shrinks: without it, every compilation of an edited document adds to it,
/// until the wasm's 4 GB are used up and an allocation fails.
const CACHE_MAX_AGE: usize = 10;

#[derive(Serialize)]
struct CompileJson {
    /// Empty if compilation failed; the previous pages are then still valid
    /// for display but no longer hit-testable.
    pages: Vec<PageJson>,
    diagnostics: Vec<DiagnosticJson>,
    /// Packages (`@namespace/name:version`) the document imports that have
    /// no files in the engine; add them and compile again.
    #[serde(rename = "missingPackages")]
    missing_packages: Vec<String>,
}

/// What `exportPdf` reports besides the PDF itself.
#[derive(Serialize)]
struct PdfReportJson {
    diagnostics: Vec<DiagnosticJson>,
    #[serde(rename = "missingPackages")]
    missing_packages: Vec<String>,
}

/// The outcome of `Engine::exportPdf`: the PDF file, if compilation and export
/// succeeded, and a `PdfReportJson` string (errors, warnings, missing packages).
#[wasm_bindgen]
pub struct PdfExport {
    pdf: Option<Vec<u8>>,
    report: String,
}

#[wasm_bindgen]
impl PdfExport {
    /// The PDF file; `undefined` if the document has errors.
    pub fn pdf(&self) -> Option<Vec<u8>> {
        self.pdf.clone()
    }

    /// The `PdfReportJson` string.
    pub fn report(&self) -> String {
        self.report.clone()
    }
}

#[derive(Serialize)]
struct PageJson {
    /// Changes iff the page's content changes; lets the preview skip DOM work.
    hash: String,
    width: f64,
    height: f64,
    svg: String,
}

#[derive(Serialize)]
struct DiagnosticJson {
    severity: &'static str,
    message: String,
    hints: Vec<String>,
    /// `None` for diagnostics without a location in a project file.
    path: Option<String>,
    from: usize,
    to: usize,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum JumpJson {
    /// A location in a source file. `from..to` is the syntax node that
    /// produced the clicked text (e.g. a text run), for highlighting it in the
    /// editor; `boxes` is where that node is drawn, for highlighting it in the
    /// preview (one box per line/page; empty for non-text such as shapes).
    Source { path: String, offset: usize, from: usize, to: usize, boxes: Vec<BoxJson> },
    Url { url: String },
    Position(PositionJson),
}

#[derive(Serialize)]
struct BoxJson {
    page: usize,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

#[derive(Serialize)]
struct PositionJson {
    page: usize,
    x: f64,
    y: f64,
}

#[wasm_bindgen]
impl Engine {
    #[wasm_bindgen(constructor)]
    #[allow(clippy::new_without_default)]
    pub fn new() -> Engine {
        Engine { world: MemoryWorld::new(), document: None, svg_cache: HashMap::new() }
    }

    /// Adds all faces of a font file. Returns how many were added (0 for
    /// data that is not a font). Fonts cannot be removed.
    #[wasm_bindgen(js_name = addFont)]
    pub fn add_font(&mut self, data: Vec<u8>) -> usize {
        self.world.add_font(data)
    }

    /// Adds the faces of a font file without its data: `faces` is the
    /// `FaceInfo[]` JSON `describeFont` returned for the file, and `loader`'s
    /// `load()` is called when a compilation first uses one of them. Returns
    /// how many faces were added (0 for JSON that does not describe faces).
    #[wasm_bindgen(js_name = addLazyFont)]
    pub fn add_lazy_font(&mut self, faces: &str, loader: FontLoader) -> usize {
        let Ok(faces) = serde_json::from_str::<Vec<FaceInfo>>(faces) else { return 0 };
        let added = faces.len();
        self.world.add_lazy_font(faces, loader);
        added
    }

    /// Adds or replaces a source file. Returns false for an invalid path.
    #[wasm_bindgen(js_name = setSource)]
    pub fn set_source(&mut self, path: &str, text: &str) -> bool {
        file_id(path).map(|id| self.world.set_source(id, text)).is_some()
    }

    /// Adds or replaces a binary file (image, data, ...). A project file
    /// ending in `.ttf`, `.otf`, `.ttc` or `.otc` is a font as well, until
    /// it is removed.
    #[wasm_bindgen(js_name = setBinary)]
    pub fn set_binary(&mut self, path: &str, data: Vec<u8>) -> bool {
        file_id(path).map(|id| self.world.set_binary(id, data)).is_some()
    }

    pub fn remove(&mut self, path: &str) {
        if let Some(id) = file_id(path) {
            self.world.remove(id);
        }
    }

    /// Compiles `main` and returns a `CompileJson` string.
    pub fn compile(&mut self, main: &str) -> String {
        let Some(id) = file_id(main) else {
            return to_json(&CompileJson { pages: vec![], diagnostics: vec![], missing_packages: vec![] });
        };
        self.world.set_main(id);
        let warned = typst::compile::<PagedDocument>(&self.world);
        let mut diagnostics: Vec<_> = warned.warnings.iter().map(|d| self.diagnostic(d)).collect();
        let pages = match warned.output {
            Ok(document) => {
                let pages = self.render_pages(&document);
                self.document = Some(document);
                pages
            }
            Err(errors) => {
                diagnostics.extend(errors.iter().map(|d| self.diagnostic(d)));
                self.document = None;
                vec![]
            }
        };
        let missing_packages = self.world.take_missing_packages();
        typst::comemo::evict(CACHE_MAX_AGE);
        to_json(&CompileJson { pages, diagnostics, missing_packages })
    }

    /// Compiles `main` and exports it as PDF. Leaves the document used for
    /// hit-testing (the last `compile`) and the main file untouched, so a
    /// download can compile a different entry than the preview.
    #[wasm_bindgen(js_name = exportPdf)]
    pub fn export_pdf(&mut self, main: &str) -> PdfExport {
        let Some(id) = file_id(main) else {
            let report = PdfReportJson { diagnostics: vec![], missing_packages: vec![] };
            return PdfExport { pdf: None, report: to_json(&report) };
        };
        let previous = self.world.main();
        self.world.set_main(id);
        let warned = typst::compile::<PagedDocument>(&self.world);
        self.world.set_main(previous);
        let mut diagnostics: Vec<_> = warned.warnings.iter().map(|d| self.diagnostic(d)).collect();
        let exported = warned
            .output
            .and_then(|document| typst_pdf::pdf(&document, &typst_pdf::PdfOptions::default()));
        let pdf = match exported {
            Ok(bytes) => Some(bytes),
            Err(errors) => {
                diagnostics.extend(errors.iter().map(|d| self.diagnostic(d)));
                None
            }
        };
        let missing_packages = self.world.take_missing_packages();
        typst::comemo::evict(CACHE_MAX_AGE);
        PdfExport { pdf, report: to_json(&PdfReportJson { diagnostics, missing_packages }) }
    }

    /// Resolves a click on `page` at (`x`, `y`) points to a `JumpJson`
    /// string, or `undefined` if nothing jumpable is there.
    #[wasm_bindgen(js_name = jumpFromClick)]
    pub fn jump_from_click(&self, page: usize, x: f64, y: f64) -> Option<String> {
        let document = self.document.as_ref()?;
        let position = PagedPosition {
            page: NonZeroUsize::new(page + 1)?,
            point: Point::new(Abs::pt(x), Abs::pt(y)),
        };
        let jump = match typst_ide::jump_from_click(&self.world, document, &position)? {
            Jump::File(id, byte) => self.source_jump(id, byte, &position)?,
            Jump::Url(url) => JumpJson::Url { url: url.as_str().into() },
            Jump::Position(pos) => JumpJson::Position(position_json(&pos)),
        };
        Some(to_json(&jump))
    }

    /// Returns the preview positions (`PositionJson[]` as JSON) showing the
    /// cursor at `offset` in `path`, the one it is shown at first; empty if
    /// nothing there is drawn (see `cursor_positions`).
    #[wasm_bindgen(js_name = jumpFromCursor)]
    pub fn jump_from_cursor(&self, path: &str, offset: usize) -> String {
        let positions = (|| {
            let document = self.document.as_ref()?;
            let source = self.world.loaded_source(file_id(path)?)?;
            let byte = source.lines().utf16_to_byte(offset)?;
            Some(cursor_positions(document, source, byte))
        })()
        .unwrap_or_default();
        to_json(&positions.iter().map(position_json).collect::<Vec<_>>())
    }

    /// Returns where the text of the source ranges `[from, to, from, to, ...]`
    /// (UTF-16) of `path` is drawn, as `BoxJson[]` JSON: one box per run of
    /// glyphs whose source character lies in one of the ranges, and one per
    /// shape or image whose syntax node starts in one of them. Everything an
    /// element whose call lies wholly in one of the ranges draws counts, too,
    /// also what a package or another file draws for it (a figure's picture).
    #[wasm_bindgen(js_name = boxesForRanges)]
    pub fn boxes_for_ranges(&self, path: &str, ranges: Vec<u32>) -> String {
        let boxes = (|| {
            let document = self.document.as_ref()?;
            let id = file_id(path)?;
            let source = self.world.loaded_source(id)?;
            let lines = source.lines();
            let bytes: Vec<Range<usize>> = ranges
                .chunks_exact(2)
                .filter_map(|r| Some(lines.utf16_to_byte(r[0] as usize)?..lines.utf16_to_byte(r[1] as usize)?))
                .collect();
            let nodes = std::cell::RefCell::new(HashMap::<Span, Option<Range<usize>>>::new());
            // The span's syntax node, if it is in `path`.
            let node = |span: Span| {
                if span.id() != Some(id) {
                    return None;
                }
                nodes.borrow_mut().entry(span).or_insert_with(|| self.world.range(span)).clone()
            };
            Some(highlight::drawn_boxes(
                document,
                |span, offset| {
                    node(span).is_some_and(|node| {
                        let byte = node.start + offset as usize;
                        bytes.iter().any(|range| range.contains(&byte))
                    })
                },
                |span| {
                    node(span).is_some_and(|node| {
                        bytes.iter().any(|range| range.start <= node.start && node.end <= range.end)
                    })
                },
            ))
        })()
        .unwrap_or_default();
        to_json(&boxes.into_iter().map(box_json).collect::<Vec<_>>())
    }
}

impl Engine {
    fn render_pages(&mut self, document: &PagedDocument) -> Vec<PageJson> {
        let options = typst_svg::SvgOptions::default();
        let mut cache = HashMap::with_capacity(document.pages().len());
        let pages = document
            .pages()
            .iter()
            .map(|page| {
                let hash = hash128(&page.frame);
                let svg = self
                    .svg_cache
                    .remove(&hash)
                    .or_else(|| cache.get(&hash).cloned())
                    .unwrap_or_else(|| typst_svg::svg(page, &options));
                cache.insert(hash, svg.clone());
                let size = page.frame.size();
                PageJson {
                    hash: format!("{hash:032x}"),
                    width: size.x.to_pt(),
                    height: size.y.to_pt(),
                    svg,
                }
            })
            .collect();
        self.svg_cache = cache;
        pages
    }

    /// The jump for a click that landed on source `byte` in file `id`. Prefers
    /// the span of the glyph under the click: its node range and its boxes
    /// give precise highlights; falls back to the syntax leaf at `byte`.
    fn source_jump(&self, id: FileId, byte: usize, click: &PagedPosition) -> Option<JumpJson> {
        let source = self.world.loaded_source(id)?;
        let document = self.document.as_ref()?;
        let page = document.pages().get(click.page.get() - 1)?;
        let span = highlight::span_at(&page.frame, click.point).filter(|span| span.id() == Some(id));
        let range = span
            .and_then(|span| self.world.range(span))
            .or_else(|| LinkedNode::new(source.root()).leaf_at(byte, Side::After).map(|leaf| leaf.range()))
            .unwrap_or(byte..byte);
        let boxes = span.map(|span| highlight::span_boxes(document, span)).unwrap_or_default();
        Some(JumpJson::Source {
            path: file_path(id),
            offset: utf16(source, byte),
            from: utf16(source, range.start),
            to: utf16(source, range.end),
            boxes: boxes.into_iter().map(box_json).collect(),
        })
    }

    fn diagnostic(&self, diag: &SourceDiagnostic) -> DiagnosticJson {
        let located = diag.span.id().and_then(|id| {
            let source = self.world.loaded_source(id)?;
            let range = self.world.range(diag.span)?;
            Some((file_path(id), utf16(source, range.start), utf16(source, range.end)))
        });
        let (path, from, to) = match located {
            Some((path, from, to)) => (Some(path), from, to),
            None => (None, 0, 0),
        };
        DiagnosticJson {
            severity: match diag.severity {
                Severity::Error => "error",
                Severity::Warning => "warning",
            },
            message: diag.message.to_string(),
            hints: diag.hints.iter().map(|h| h.v.to_string()).collect(),
            path,
            from,
            to,
        }
    }
}

/// Where the cursor at `byte` of `source` is shown in `document`: where its
/// text is drawn (`typst_ide::jump_from_cursor`, one position per page), from
/// where the element around it starts on (a heading, a figure, an equation):
/// a copy of the text drawn before, as an outline's entry of a heading, is not
/// where the cursor is. Where nothing is drawn for the text at the cursor (a
/// label, a heading's `=`, a figure's call), the element's start.
fn cursor_positions(document: &PagedDocument, source: &Source, byte: usize) -> Vec<PagedPosition> {
    let drawn = typst_ide::jump_from_cursor(document, source, byte);
    let Some(start) = element_start(document, source, byte) else {
        return drawn;
    };
    let after: Vec<PagedPosition> = drawn
        .into_iter()
        .filter(|position| (position.page, position.point.y) >= (start.page, start.point.y))
        .collect();
    if after.is_empty() { vec![start] } else { after }
}

/// Where the innermost element the document places (`Locatable`) around the
/// cursor at `byte` starts; for a label in markup, the element it labels.
fn element_start(document: &PagedDocument, source: &Source, byte: usize) -> Option<PagedPosition> {
    let root = LinkedNode::new(source.root());
    let is_text = |leaf: &LinkedNode| matches!(leaf.kind(), SyntaxKind::Text | SyntaxKind::MathText);
    let leaf = root
        .leaf_at(byte, Side::Before)
        .filter(is_text)
        .or_else(|| root.leaf_at(byte, Side::After))?;
    let labelled = leaf.kind() == SyntaxKind::Label && leaf.parent_kind() == Some(SyntaxKind::Markup);
    let node = if labelled { leaf.prev_sibling()? } else { leaf };
    // the spans of the node and its ancestors, innermost first
    let spans: Vec<Span> = std::iter::successors(Some(&node), |node| node.parent()).map(|node| node.span()).collect();
    let elements = document.introspector().elements();
    // the first element (in document order) of the innermost span that has one
    let (_, index) = elements
        .all()
        .enumerate()
        .filter_map(|(index, element)| Some((spans.iter().position(|span| *span == element.span())?, index)))
        .min()?;
    Some(*elements.get_pos_by_idx(index))
}

fn utf16(source: &Source, byte: usize) -> usize {
    source.lines().byte_to_utf16(byte).unwrap_or(0)
}

fn box_json(b: highlight::PageBox) -> BoxJson {
    BoxJson { page: b.page, x: b.x, y: b.y, w: b.w, h: b.h }
}

fn position_json(pos: &PagedPosition) -> PositionJson {
    PositionJson { page: pos.page.get() - 1, x: pos.point.x.to_pt(), y: pos.point.y.to_pt() }
}

fn to_json<T: Serialize>(value: &T) -> String {
    serde_json::to_string(value).expect("JSON types are always serializable")
}
