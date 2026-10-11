//! An in-memory Typst [`World`]: files and fonts are pushed in from JS. No
//! fonts are embedded, which keeps the wasm small; the JS side loads them as
//! separate assets, either right away or lazily: Typst's font book needs every
//! face's [`FontInfo`] up front, but a face's data only when a document uses
//! it, so a lazy font's file is loaded by [`World::font`] on first use.
//! Packages are pushed in as files; the world only remembers which ones a
//! compilation asked for but did not have.

use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};

use typst::diag::{FileError, FileResult, PackageError};
use typst::syntax::package::PackageSpec;
use typst::foundations::{Bytes, Datetime, Duration};
use typst::syntax::{FileId, RootedPath, Source, VirtualPath, VirtualRoot};
use typst::text::{Font, FontBook, FontInfo};
use typst::utils::LazyHash;
use typst::{Library, LibraryExt, World};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
    /// A JS object (`LazyFont` in typst-engine.ts) that loads a font file's
    /// data, synchronously: [`World::font`] cannot wait.
    pub type FontLoader;

    /// The file's bytes; `null` if it cannot be loaded.
    #[wasm_bindgen(method)]
    fn load(this: &FontLoader) -> Option<Vec<u8>>;
}

/// A face as the font index describes it: Typst's [`FontInfo`] plus the face's
/// index in its file (a collection has several).
#[derive(serde::Serialize, serde::Deserialize)]
pub struct FaceInfo {
    pub index: u32,
    #[serde(flatten)]
    pub info: FontInfo,
}

/// The faces of a font file, for an index of lazy fonts.
pub fn describe_font(data: &[u8]) -> Vec<FaceInfo> {
    Font::iter(Bytes::new(data.to_vec()))
        .map(|font| FaceInfo { index: font.index(), info: font.info().clone() })
        .collect()
}

/// A face of the font book. Its font is set when added with data, or made on
/// first use from its lazy file.
struct FontSlot {
    font: OnceLock<Option<Font>>,
    /// For a lazy face: its file in `lazy_files` and its index in that file.
    lazy: Option<(usize, u32)>,
}

/// A font file whose data is loaded on first use of one of its faces.
struct LazyFile {
    loader: FontLoader,
    data: OnceLock<Option<Bytes>>,
}

// SAFETY: the engine runs in wasm32 without threads, so the JS loader is never
// touched from another thread. `World` requires `Send + Sync` all the same.
unsafe impl Send for LazyFile {}
unsafe impl Sync for LazyFile {}

impl LazyFile {
    fn data(&self) -> Option<Bytes> {
        self.data.get_or_init(|| self.loader.load().map(Bytes::new)).clone()
    }
}

enum File {
    Source(Source),
    Binary(Bytes),
}

pub struct MemoryWorld {
    library: LazyHash<Library>,
    book: LazyHash<FontBook>,
    /// One per face of the book, in the same order.
    fonts: Vec<FontSlot>,
    lazy_files: Vec<LazyFile>,
    files: HashMap<FileId, File>,
    /// Packages with at least one file present.
    packages: HashSet<PackageSpec>,
    /// Packages a compilation requested that are not in `packages`. Behind a
    /// mutex because `World` methods take `&self` and must be `Sync`.
    missing: Mutex<HashSet<PackageSpec>>,
    main: FileId,
}

impl MemoryWorld {
    pub fn new() -> Self {
        Self {
            library: LazyHash::new(Library::default()),
            book: LazyHash::new(FontBook::new()),
            fonts: Vec::new(),
            lazy_files: Vec::new(),
            files: HashMap::new(),
            packages: HashSet::new(),
            missing: Mutex::new(HashSet::new()),
            main: file_id("/main.typ").expect("valid path"),
        }
    }

    /// Adds every face of a font file (OpenType/TrueType, or a collection).
    /// Returns the number of faces added; 0 if `data` is not a font.
    pub fn add_font(&mut self, data: Vec<u8>) -> usize {
        let faces: Vec<Font> = Font::iter(Bytes::new(data)).collect();
        let added = faces.len();
        for font in faces {
            self.book.push(font.info().clone());
            self.fonts.push(FontSlot { font: OnceLock::from(Some(font)), lazy: None });
        }
        added
    }

    /// Adds the `faces` of a font file whose data `loader` gives on first use.
    pub fn add_lazy_font(&mut self, faces: Vec<FaceInfo>, loader: FontLoader) {
        let file = self.lazy_files.len();
        self.lazy_files.push(LazyFile { loader, data: OnceLock::new() });
        for face in faces {
            self.book.push(face.info);
            self.fonts.push(FontSlot { font: OnceLock::new(), lazy: Some((file, face.index)) });
        }
    }

    /// Sets the text of a source file. Reuses the existing [`Source`] so that
    /// Typst can reparse incrementally and keep spans of unchanged nodes stable.
    pub fn set_source(&mut self, id: FileId, text: &str) {
        self.note_package(id);
        match self.files.get_mut(&id) {
            Some(File::Source(source)) => {
                source.replace(text);
            }
            _ => {
                self.files.insert(id, File::Source(Source::new(id, text.into())));
            }
        }
    }

    pub fn set_binary(&mut self, id: FileId, data: Vec<u8>) {
        self.note_package(id);
        self.files.insert(id, File::Binary(Bytes::new(data)));
    }

    pub fn remove(&mut self, id: FileId) {
        self.files.remove(&id);
    }

    pub fn set_main(&mut self, id: FileId) {
        self.main = id;
    }

    /// The packages requested since the last call that have no files, as
    /// `@namespace/name:version` strings, sorted.
    pub fn take_missing_packages(&mut self) -> Vec<String> {
        let missing = std::mem::take(self.missing.get_mut().expect("not poisoned"));
        let mut specs: Vec<String> = missing.iter().map(ToString::to_string).collect();
        specs.sort();
        specs
    }

    fn note_package(&mut self, id: FileId) {
        if let VirtualRoot::Package(spec) = id.get().root() {
            self.packages.insert(spec.clone());
        }
    }

    /// The error for a file that is not there. A file of a package that has
    /// no files at all is recorded as a missing package.
    fn not_found(&self, id: FileId) -> FileError {
        let rooted = id.get();
        match rooted.root() {
            VirtualRoot::Package(spec) if !self.packages.contains(spec) => {
                self.missing.lock().expect("not poisoned").insert(spec.clone());
                FileError::Package(PackageError::NotFound(spec.clone()))
            }
            _ => FileError::NotFound(rooted.vpath().get_without_slash().into()),
        }
    }

    /// The already loaded source, without going through the `World` error path.
    pub fn loaded_source(&self, id: FileId) -> Option<&Source> {
        match self.files.get(&id) {
            Some(File::Source(source)) => Some(source),
            _ => None,
        }
    }
}

/// Maps a JS-facing path to an interned file id: `/main.typ` is a project
/// file, `@preview/name:0.1.0/lib.typ` a file of a package.
pub fn file_id(path: &str) -> Option<FileId> {
    let (root, vpath) = match path.strip_prefix('@') {
        Some(rest) => {
            let (namespace, rest) = rest.split_once('/')?;
            let slash = rest.find('/')?;
            let spec: PackageSpec = format!("@{namespace}/{}", &rest[..slash]).parse().ok()?;
            (VirtualRoot::Package(spec), &rest[slash..])
        }
        None => (VirtualRoot::Project, path),
    };
    let vpath = VirtualPath::new(vpath).ok()?;
    Some(RootedPath::new(root, vpath).intern())
}

/// The inverse of [`file_id`].
pub fn file_path(id: FileId) -> String {
    let rooted = id.get();
    let path = rooted.vpath().get_with_slash();
    match rooted.root() {
        VirtualRoot::Project => path.to_string(),
        VirtualRoot::Package(spec) => format!("{spec}{path}"),
    }
}

impl World for MemoryWorld {
    fn library(&self) -> &LazyHash<Library> {
        &self.library
    }

    fn book(&self) -> &LazyHash<FontBook> {
        &self.book
    }

    fn main(&self) -> FileId {
        self.main
    }

    fn source(&self, id: FileId) -> FileResult<Source> {
        match self.files.get(&id) {
            Some(File::Source(source)) => Ok(source.clone()),
            Some(File::Binary(_)) => Err(FileError::InvalidUtf8),
            None => Err(self.not_found(id)),
        }
    }

    fn file(&self, id: FileId) -> FileResult<Bytes> {
        match self.files.get(&id) {
            Some(File::Binary(bytes)) => Ok(bytes.clone()),
            Some(File::Source(source)) => Ok(Bytes::from_string(source.text().to_string())),
            None => Err(self.not_found(id)),
        }
    }

    fn font(&self, index: usize) -> Option<Font> {
        let slot = self.fonts.get(index)?;
        slot.font
            .get_or_init(|| {
                let (file, face) = slot.lazy?;
                Font::new(self.lazy_files[file].data()?, face)
            })
            .clone()
    }

    fn today(&self, _offset: Option<Duration>) -> Option<Datetime> {
        // Deterministic output; `datetime.today()` is rarely needed in documents
        // edited here and would make every compile differ.
        None
    }
}

impl typst_ide::IdeWorld for MemoryWorld {
    fn upcast(&self) -> &dyn World {
        self
    }
}
