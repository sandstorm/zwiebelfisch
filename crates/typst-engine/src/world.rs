//! An in-memory Typst [`World`]: files and fonts are pushed in from JS. No
//! fonts are embedded, which keeps the wasm small; the JS side loads them as
//! separate assets.

use std::collections::HashMap;

use typst::diag::{FileError, FileResult};
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
    main: FileId,
}

impl MemoryWorld {
    pub fn new() -> Self {
        Self {
            library: LazyHash::new(Library::default()),
            book: LazyHash::new(FontBook::new()),
            fonts: Vec::new(),
            files: HashMap::new(),
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
        self.files.insert(id, File::Binary(Bytes::new(data)));
    }

    pub fn remove(&mut self, id: FileId) {
        self.files.remove(&id);
    }

    pub fn set_main(&mut self, id: FileId) {
        self.main = id;
    }

    /// The already loaded source, without going through the `World` error path.
    pub fn loaded_source(&self, id: FileId) -> Option<&Source> {
        match self.files.get(&id) {
            Some(File::Source(source)) => Some(source),
            _ => None,
        }
    }
}

/// Maps a JS-facing path like `/main.typ` to an interned project file id.
pub fn file_id(path: &str) -> Option<FileId> {
    let vpath = VirtualPath::new(path).ok()?;
    Some(RootedPath::new(VirtualRoot::Project, vpath).intern())
}

/// The inverse of [`file_id`] for project files; `None` for package files.
pub fn file_path(id: FileId) -> Option<String> {
    let rooted = id.get();
    match rooted.root() {
        VirtualRoot::Project => Some(rooted.vpath().get_with_slash().to_string()),
        VirtualRoot::Package(_) => None,
    }
}

fn not_found(id: FileId) -> FileError {
    FileError::NotFound(id.get().vpath().get_without_slash().into())
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
            None => Err(not_found(id)),
        }
    }

    fn file(&self, id: FileId) -> FileResult<Bytes> {
        match self.files.get(&id) {
            Some(File::Binary(bytes)) => Ok(bytes.clone()),
            Some(File::Source(source)) => Ok(Bytes::from_string(source.text().to_string())),
            None => Err(not_found(id)),
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
