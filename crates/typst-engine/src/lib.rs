//! Typst compiler, SVG renderer and source <-> preview hit-testing, packaged
//! for the browser.
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

mod highlight;
mod world;

use std::collections::HashMap;
use std::num::NonZeroUsize;

use serde::Serialize;
use typst::diag::{Severity, SourceDiagnostic};
use typst::layout::{Abs, Point};
use typst_layout::PagedDocument;
use typst::introspection::PagedPosition;
use typst::syntax::{FileId, LinkedNode, Side, Source};
use typst::utils::hash128;
use typst::WorldExt;
use typst_ide::Jump;
use wasm_bindgen::prelude::*;

use world::{file_id, file_path, MemoryWorld};

#[wasm_bindgen]
pub struct Engine {
    world: MemoryWorld,
    document: Option<PagedDocument>,
    /// SVGs of the pages of the last compilation, keyed by frame hash, so
    /// unchanged pages are not re-exported.
    svg_cache: HashMap<u128, String>,
}

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

    /// Adds or replaces a source file. Returns false for an invalid path.
    #[wasm_bindgen(js_name = setSource)]
    pub fn set_source(&mut self, path: &str, text: &str) -> bool {
        file_id(path).map(|id| self.world.set_source(id, text)).is_some()
    }

    /// Adds or replaces a binary file (image, data, ...).
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
        to_json(&CompileJson { pages, diagnostics, missing_packages })
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
    /// text at `offset` in `path`; empty if it is not visible text.
    #[wasm_bindgen(js_name = jumpFromCursor)]
    pub fn jump_from_cursor(&self, path: &str, offset: usize) -> String {
        let positions = (|| {
            let document = self.document.as_ref()?;
            let source = self.world.loaded_source(file_id(path)?)?;
            let byte = source.lines().utf16_to_byte(offset)?;
            Some(typst_ide::jump_from_cursor(document, source, byte))
        })()
        .unwrap_or_default();
        to_json(&positions.iter().map(position_json).collect::<Vec<_>>())
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
            boxes: boxes
                .into_iter()
                .map(|b| BoxJson { page: b.page, x: b.x, y: b.y, w: b.w, h: b.h })
                .collect(),
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

fn utf16(source: &Source, byte: usize) -> usize {
    source.lines().byte_to_utf16(byte).unwrap_or(0)
}

fn position_json(pos: &PagedPosition) -> PositionJson {
    PositionJson { page: pos.page.get() - 1, x: pos.point.x.to_pt(), y: pos.point.y.to_pt() }
}

fn to_json<T: Serialize>(value: &T) -> String {
    serde_json::to_string(value).expect("JSON types are always serializable")
}
