// The built-in contributions to the Visual view: every Typst construct beyond paragraphs and raw Typst, and the
// Visual-view parts of the widget's features. Entry of visual-view/builtins/. See ARCHITECTURE.md, "VisualView".
// A construct without configuration is itself an extension in the widget's built-in list; a feature's extension
// activates the contributions it configures (`references` with its LabelIndex, …). They use only the contribution
// API, and move into extensions/<name>/visual-view/ with their feature.
export { alignment } from './alignment/alignment';
export { boxLinks, type BoxLinksOptions } from './box-links/box-links';
export { headingNumbers } from './heading-numbers/heading-numbers';
export { headings } from './headings';
export { horizontalRule } from './horizontal-rule';
export { images, type ImageAssets, type ImagesOptions, type ImageUrls } from './images/images';
export { lists } from './lists';
export { marginNotes, type MarginNotesOptions } from './margin-notes';
export { markup } from './markup/markup';
export { notesGutter, type NotesGutterContribution, type NotesGutterOptions } from './notes-gutter/notes-gutter';
export { outline } from './outline';
export { pageBreak } from './page-break';
export { renderedBoxes, type RenderedBoxesOptions, type Snippet, type SnippetSource } from './rendered-boxes/rendered-boxes';
export { tables } from './tables/tables';
export { taskLists } from './task-lists/task-lists';

import type { ImageUrls } from './images/images';
import type { SnippetSource } from './rendered-boxes/rendered-boxes';

/** What a document's raw boxes show while not edited: compiled snippets and image files. */
export type Renderings = SnippetSource & ImageUrls;
