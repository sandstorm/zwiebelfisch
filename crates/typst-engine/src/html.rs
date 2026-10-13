//! HTML export for the preview: the document as files (Typst's bundle export,
//! or one `index.html`), each HTML element with a source span marked with an
//! attribute, and an index from source spans to those elements, so the
//! preview can go from the cursor to the page and element it produced.

use std::collections::HashMap;
use std::sync::Arc;

use typst::diag::{SourceDiagnostic, SourceResult, Warned};
use typst::foundations::Bytes;
use typst::syntax::{LinkedNode, Side, Source, Span, SyntaxKind};
use typst::World;
use typst::ecow::{eco_format, EcoString, EcoVec};
use typst_bundle::{Bundle, BundleDocument, BundleFile, BundleOptions};
use typst_html::{HtmlAttr, HtmlDocument, HtmlElement, HtmlNode, HtmlOptions};

/// The attribute marking an element with a source span; its value is unique
/// within the element's file and stays the same while its source is edited
/// elsewhere (the span's number, plus `.2`, `.3` for later elements of the
/// same span).
const ELEMENT_ATTR: &str = "data-typst-element";

/// A compiled HTML export: its files in bundle order, and where the elements
/// of each source span are.
pub struct HtmlExport {
    pub files: Vec<HtmlFile>,
    pub elements: ElementIndex,
}

pub struct HtmlFile {
    /// The bundle path without leading slash (`index.html`, `assets/logo.svg`).
    pub path: String,
    /// Whether this is an HTML document (else an asset or a paged document).
    pub document: bool,
    pub data: Bytes,
}

/// Compiles the world's main file to HTML: as a bundle when it makes
/// documents (`#document("x.html", ..)`), else as one HTML document,
/// `index.html`. Typst's warnings that HTML and bundle export are experimental
/// are left out: the preview chose to use them.
pub fn compile(world: &dyn World) -> Warned<SourceResult<HtmlExport>> {
    let bundled = typst::compile::<Bundle>(world);
    let Warned { output, warnings } = match bundled.output {
        Err(errors) if errors.iter().all(is_top_level_error) => {
            let single = typst::compile::<HtmlDocument>(world);
            Warned { output: single.output.and_then(export_single), warnings: single.warnings }
        }
        output => Warned { output: output.and_then(export_bundle), warnings: bundled.warnings },
    };
    Warned { output, warnings: warnings.into_iter().filter(|w| !is_experimental_warning(w)).collect() }
}

fn export_bundle(bundle: Bundle) -> SourceResult<HtmlExport> {
    let mut index = ElementIndex::default();
    let mut files = (*bundle.files).clone();
    for (path, file) in files.iter_mut() {
        if let BundleFile::Document(BundleDocument::Html(document)) = file {
            index.add_document(path.get_without_slash().into(), document.root_mut());
        }
    }
    let documents: Vec<bool> = files
        .values()
        .map(|file| matches!(file, BundleFile::Document(BundleDocument::Html(_))))
        .collect();
    let marked = Bundle { files: Arc::new(files), introspector: bundle.introspector.clone() };
    let options = BundleOptions { html: HtmlOptions { pretty: false }, ..BundleOptions::default() };
    let exported = typst_bundle::export(&marked, &options)?;
    let files = exported
        .into_iter()
        .zip(documents)
        .map(|((path, data), document)| HtmlFile { path: path.get_without_slash().into(), document, data })
        .collect();
    Ok(HtmlExport { files, elements: index })
}

fn export_single(mut document: HtmlDocument) -> SourceResult<HtmlExport> {
    let mut index = ElementIndex::default();
    index.add_document(SINGLE_DOCUMENT.into(), document.root_mut());
    let html = typst_html::html(&document, &HtmlOptions { pretty: false })?;
    let file = HtmlFile { path: SINGLE_DOCUMENT.into(), document: true, data: Bytes::from_string(html) };
    Ok(HtmlExport { files: vec![file], elements: index })
}

/// The file of a document that makes no `document(..)` of its own.
const SINGLE_DOCUMENT: &str = "index.html";

/// The error of content outside any `document(..)` in a bundle: the main
/// file is one document, not a bundle.
fn is_top_level_error(diagnostic: &SourceDiagnostic) -> bool {
    diagnostic.message.ends_with("is not allowed at the top-level in bundle export")
}

fn is_experimental_warning(diagnostic: &SourceDiagnostic) -> bool {
    diagnostic.span.is_detached()
        && (diagnostic.message.starts_with("html export is under active development")
            || diagnostic.message.starts_with("bundle export is experimental"))
}

/// Where the HTML elements of each source span are, over every document of
/// an export.
#[derive(Default)]
pub struct ElementIndex {
    documents: Vec<EcoString>,
    /// Every element in document order (documents in bundle order).
    elements: Vec<Element>,
    /// The elements a span produced: the element of that span itself, or the
    /// element holding the text or frame of that span.
    by_span: HashMap<Span, Vec<u32>>,
}

struct Element {
    span: Span,
    parent: Option<u32>,
    document: u32,
    /// Its `ELEMENT_ATTR` value; none without a span.
    id: Option<EcoString>,
}

/// Marking the elements of one document: the attribute, and how many
/// elements of each span were marked so far.
struct Marking {
    attr: HtmlAttr,
    seen: HashMap<Span, u32>,
}

/// An element the cursor produced: its document and its `ELEMENT_ATTR` value
/// (none when neither it nor an ancestor has a span).
pub struct ElementLocation<'a> {
    pub path: &'a str,
    pub element: Option<&'a str>,
}

impl ElementIndex {
    /// Indexes the elements of a document and marks those with a span.
    fn add_document(&mut self, path: EcoString, root: &mut HtmlElement) {
        let document = self.documents.len() as u32;
        self.documents.push(path);
        let attr = HtmlAttr::intern(ELEMENT_ATTR).expect("a valid attribute name");
        self.add_element(root, None, document, &mut Marking { attr, seen: HashMap::new() });
    }

    fn add_element(&mut self, element: &mut HtmlElement, parent: Option<u32>, document: u32, marking: &mut Marking) {
        let index = self.elements.len() as u32;
        let id = (!element.span.is_detached()).then(|| {
            let count = marking.seen.entry(element.span).or_insert(0);
            *count += 1;
            let number = element.span.into_raw();
            let id: EcoString = if *count == 1 { eco_format!("{number:x}") } else { eco_format!("{number:x}.{count}") };
            element.attrs.push(marking.attr, id.clone());
            id
        });
        self.elements.push(Element { span: element.span, parent, document, id });
        self.produced(element.span, index);
        for child in element.children.make_mut() {
            match child {
                HtmlNode::Element(child) => self.add_element(child, Some(index), document, marking),
                HtmlNode::Text(_, span) => self.produced(*span, index),
                HtmlNode::Frame(frame) => self.produced(frame.span, index),
                HtmlNode::Tag(_) => {}
            }
        }
    }

    fn produced(&mut self, span: Span, element: u32) {
        if span.is_detached() {
            return;
        }
        let elements = self.by_span.entry(span).or_default();
        if elements.last() != Some(&element) {
            elements.push(element);
        }
    }

    /// The elements the text at `byte` of `source` produced, the first of each
    /// document that has one; empty if it produced none (a `#let`, a comment).
    ///
    /// It is the innermost syntax node around the cursor that produced an
    /// element. Where that node's output is also elsewhere (a heading's text
    /// in a table of contents), the places inside an element of an enclosing
    /// node (the heading itself) win.
    pub fn at_cursor(&self, source: &Source, byte: usize) -> Vec<ElementLocation<'_>> {
        let spans = cursor_spans(source, byte);
        let Some((i, produced)) = spans.iter().enumerate().find_map(|(i, span)| Some((i, self.by_span.get(span)?))) else {
            return vec![];
        };
        let enclosing = &spans[i..];
        let inside: EcoVec<u32> = produced
            .iter()
            .copied()
            .filter(|&element| self.ancestors(element).any(|e| enclosing.contains(&self.elements[e as usize].span)))
            .collect();
        let chosen = if inside.is_empty() { produced.as_slice() } else { inside.as_slice() };
        let mut locations: Vec<ElementLocation> = Vec::new();
        let mut last_document = None;
        for &element in chosen {
            let document = self.elements[element as usize].document;
            if last_document == Some(document) || locations.iter().any(|l| l.path == self.documents[document as usize]) {
                continue;
            }
            last_document = Some(document);
            let element = self.ancestors(element).find_map(|e| self.elements[e as usize].id.as_deref());
            locations.push(ElementLocation { path: &self.documents[document as usize], element });
        }
        locations
    }

    /// `element` and its ancestors, innermost first.
    fn ancestors(&self, element: u32) -> impl Iterator<Item = u32> + '_ {
        std::iter::successors(Some(element), |&e| self.elements[e as usize].parent)
    }
}

/// The spans of the syntax node at the cursor and of its ancestors, innermost
/// first, without the file's root (which stands for all of it). For a label in
/// markup, the node it labels.
fn cursor_spans(source: &Source, byte: usize) -> Vec<Span> {
    let root = LinkedNode::new(source.root());
    let is_text = |leaf: &LinkedNode| matches!(leaf.kind(), SyntaxKind::Text | SyntaxKind::MathText);
    let Some(leaf) = root.leaf_at(byte, Side::Before).filter(is_text).or_else(|| root.leaf_at(byte, Side::After)) else {
        return vec![];
    };
    let labelled = leaf.kind() == SyntaxKind::Label && leaf.parent_kind() == Some(SyntaxKind::Markup);
    let node = if labelled { leaf.prev_sibling().unwrap_or(leaf) } else { leaf };
    std::iter::successors(Some(&node), |node| node.parent())
        .filter(|node| node.parent().is_some())
        .map(|node| node.span())
        .collect()
}
