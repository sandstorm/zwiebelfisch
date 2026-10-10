//! An in-memory Typst [`World`]: files and fonts are pushed in from JS. No
//! fonts are embedded, which keeps the wasm small; the JS side loads them as
//! separate assets. Packages are pushed in as files too; the world only
//! remembers which ones a compilation asked for but did not have.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use typst::diag::{FileError, FileResult, PackageError};
use typst::syntax::package::PackageSpec;
use typst::foundations::{Bytes, Datetime, Duration};
use typst::syntax::{FileId, RootedPath, Source, VirtualPath, VirtualRoot};
use typst::text::{Font, FontBook};
use typst::utils::LazyHash;
use typst::{Library, LibraryExt, World};

enum File {
    Source(Source),
    Binary(Bytes),
}

pub struct MemoryWorld {
    library: LazyHash<Library>,
    book: LazyHash<FontBook>,
    fonts: Vec<Font>,
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
        for font in &faces {
            self.book.push(font.info().clone());
        }
        let added = faces.len();
        self.fonts.extend(faces);
        added
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
        self.fonts.get(index).cloned()
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
