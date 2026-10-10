// The Visual-view parts of the widget's features that have not moved into extensions/ yet. Entry of
// visual-view/builtins/. See ARCHITECTURE.md, "VisualView". A feature's extension activates the contributions it
// configures (`references` with its LabelIndex, …). They use only the contribution API, and move into
// extensions/<name>/visual-view/ with their feature. (The Typst constructs are in extensions/ already.)
export { boxLinks, type BoxLinksOptions } from './box-links/box-links';
export { images, type ImageAssets, type ImagesOptions, type ImageUrls } from './images/images';
export { marginNotes, type MarginNotesOptions } from './margin-notes';
export { notesGutter, type NotesGutterContribution, type NotesGutterOptions } from './notes-gutter/notes-gutter';
export { references, type ReferencesOptions } from './references/references';
export { renderedBoxes, type RenderedBoxesOptions, type Snippet, type SnippetSource } from './rendered-boxes/rendered-boxes';
export { customStyles, type StyleSource, type StylesOptions } from './styles/styles';

import type { ImageUrls } from './images/images';
import type { SnippetSource } from './rendered-boxes/rendered-boxes';

/** What a document's raw boxes show while not edited: compiled snippets and image files. */
export type Renderings = SnippetSource & ImageUrls;
