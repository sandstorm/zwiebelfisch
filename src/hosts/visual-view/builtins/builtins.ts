// The built-in contributions to the Visual view: every Typst construct beyond paragraphs and raw Typst, and the
// features shown in it, in the order they register. Here until the extensions wave lifts each into
// extensions/<name>/visual-view/ (they use only the contribution API). Entry of visual-view/builtins/.
// See ARCHITECTURE.md, "VisualView".
import type { DocumentLinkProvider } from '../../../core/document-links/document-links';
import type { TypstDocument } from '../../../core/typst-document/typst-document';
import type { ProjectLabels } from '../../../features/labels/labels';
import type { VisualViewContribution } from '../contributions/contributions';
import { alignment } from './alignment/alignment';
import { boxLinks, imagePathLink } from './box-links/box-links';
import { headingNumbers } from './heading-numbers/heading-numbers';
import { headings } from './headings';
import { horizontalRule } from './horizontal-rule';
import { images, type ImageAssets, type ImageUrls } from './images/images';
import { lists } from './lists';
import { marginNotes } from './margin-notes';
import { markup } from './markup/markup';
import { notesGutter } from './notes-gutter/notes-gutter';
import { outline } from './outline';
import { pageBreak } from './page-break';
import { references } from './references/references';
import { renderedBoxes, type SnippetSource } from './rendered-boxes/rendered-boxes';
import { styles, type StyleSource } from './styles/styles';
import { tables } from './tables/tables';
import { taskLists } from './task-lists/task-lists';

export type { ImageAssets } from './images/images';
export type { Snippet } from './rendered-boxes/rendered-boxes';

/** What a document's raw boxes show while not edited: compiled snippets and image files. */
export type Renderings = SnippetSource & ImageUrls;

/** What the built-ins are configured with: the widget's options and services, per document where they differ. */
export interface BuiltinOptions {
  /** Shows images and compiled snippets in raw boxes while they are not edited (default: code only). */
  renderer?(document: TypstDocument): Renderings | undefined;
  /** Lets "Insert image" offer the project's images and upload new ones (default: it only asks for a path). */
  assets?(document: TypstDocument): ImageAssets | undefined;
  /** Makes file paths in raw boxes open their file (clickable image paths, links in the code). */
  documentLinks?(document: TypstDocument): DocumentLinkProvider | undefined;
  /** Who works here: signs replies in the notes gutter; only own messages can be edited (default: "Anonymous"). */
  user?: { name: string };
  /** Adds a comment (margin note) at the selection: the toolbar's "Comment" button (none without it). */
  comment?(): void;
  /**
   * The project's labels: typing `@` offers them, reference chips show what they point to (or that the label is
   * missing), and a label can be renamed with its references in every file (default: label tags only).
   */
  labels?: ProjectLabels;
  /**
   * The project's custom styles: their calls show as styled, editable text, and the text style menu applies them
   * (importing them where needed) (default: such calls stay raw boxes).
   */
  styles?: StyleSource;
  /** "New style…" in the text style menu (default: no such entry). */
  createStyle?(): void;
}

/** The built-in contributions, and the way to their notes gutter's cards. */
export interface Builtins {
  /** In registration order (which decides between projectors of the same syntax and between box renderers). */
  readonly contributions: readonly VisualViewContribution[];
  /** Focuses the card (in the notes gutter of `document`'s Visual view) of the margin note whose source holds `offset`; false if none. */
  editNote(document: TypstDocument, offset: number): boolean;
}

/** The built-in contributions, configured from `options`. */
export function builtins(options: BuiltinOptions = {}): Builtins {
  const notes = notesGutter({ user: options.user });
  const { renderer, documentLinks } = options;
  return {
    contributions: [
      markup,
      headings,
      tables,
      images({
        assets: options.assets,
        imageUrls: renderer,
        pathLink: (document) => {
          const links = documentLinks?.(document);
          return links && ((path, doc) => imagePathLink(links, path, doc));
        },
      }),
      outline,
      pageBreak,
      horizontalRule,
      // before lists: its projector gets bullet items (`- [ ] ..`) first
      taskLists,
      lists,
      headingNumbers,
      alignment,
      marginNotes({ comment: options.comment }),
      references({ labels: options.labels }),
      styles({ styles: options.styles, create: options.createStyle }),
      notes,
      boxLinks({ documentLinks }),
      // after images, whose renderer draws image boxes
      renderedBoxes({ snippets: renderer }),
    ],
    editNote: (document, offset) => notes.editNote(document, offset),
  };
}

