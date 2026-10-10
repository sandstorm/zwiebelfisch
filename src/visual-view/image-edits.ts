/**
 * The edits the image tools make to an image block (bare, or the image of a
 * figure), each one transaction, so one undo step: caption on and off, width
 * and alt text. The image call changes only in the argument concerned; the
 * projection prints everything else of the block as it was.
 */
import type { Node } from '@tiptap/pm/model';
import { NodeSelection, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { imageAlt, imageArg, withHash, withImageAlt, withImageWidth, withoutHash } from './image-call';
import { hasFigureExtras } from './projection';

/** What the image tools show for an image block. */
export interface ImageInfo {
  /** Whether it is the image of a figure with a caption. */
  caption: boolean;
  alt: string | null;
  /** The `width` argument as written. */
  width: string | null;
}

interface Located {
  image: Node;
  /** The figure around the image, if any. */
  figure: { node: Node; pos: number } | null;
}

function locate(state: EditorState, pos: number): Located | null {
  const image = state.doc.nodeAt(pos);
  if (image?.type.name !== 'image') return null;
  const $pos = state.doc.resolve(pos);
  const figure = $pos.parent.type.name === 'figure' ? { node: $pos.parent, pos: $pos.before() } : null;
  return { image, figure };
}

/** What the image block at `pos` has; null if there is none. */
export function imageInfo(state: EditorState, pos: number): ImageInfo | null {
  const located = locate(state, pos);
  if (!located) return null;
  const src: string = located.image.attrs.src;
  return { caption: (located.figure?.node.childCount ?? 0) > 1, alt: imageAlt(src), width: imageArg(src, 'width') };
}

/**
 * Gives the image at `pos` an empty caption, with the cursor in it: a bare
 * image becomes `#figure(image(..), caption: [])`, a figure without a caption
 * gets the argument right after the image call.
 */
export function addCaption(state: EditorState, pos: number): Transaction | null {
  const located = locate(state, pos);
  if (!located) return null;
  const { schema } = state;
  const { image, figure } = located;
  const tr = state.tr;
  if (figure) {
    if (figure.node.childCount > 1) return null;
    tr.insert(pos + image.nodeSize, schema.nodes.figureCaption.create());
    return tr.setSelection(TextSelection.create(tr.doc, pos + image.nodeSize + 1));
  }
  const body = schema.nodes.image.create({ src: withoutHash(image.attrs.src) });
  tr.replaceWith(pos, pos + image.nodeSize, schema.nodes.figure.create({ sep: image.attrs.sep }, [body, schema.nodes.figureCaption.create()]));
  return tr.setSelection(TextSelection.create(tr.doc, pos + 3));
}

/**
 * Removes the caption of the figure around the image at `pos`. A figure that
 * has nothing else (no label, no other arguments) becomes a bare image block
 * again; otherwise it stays a figure, so references to it keep working. The
 * image ends up selected.
 */
export function removeCaption(state: EditorState, pos: number): Transaction | null {
  const figure = locate(state, pos)?.figure;
  if (!figure || figure.node.childCount < 2) return null;
  const tr = state.tr;
  const image = figure.node.child(0);
  if (hasFigureExtras(figure.node)) {
    tr.delete(pos + image.nodeSize, figure.pos + figure.node.nodeSize - 1);
    return tr.setSelection(NodeSelection.create(tr.doc, pos));
  }
  const bare = state.schema.nodes.image.create({ src: withHash(image.attrs.src), sep: figure.node.attrs.sep });
  tr.replaceWith(figure.pos, figure.pos + figure.node.nodeSize, bare);
  return tr.setSelection(NodeSelection.create(tr.doc, figure.pos));
}

/** Sets the image's `width` to `percent` of the text width (whole percent). */
export function resizeImage(state: EditorState, pos: number, percent: number): Transaction | null {
  return editCall(state, pos, (src) => withImageWidth(src, percent));
}

/** Sets the image's alt text; an empty one removes it. */
export function setImageAlt(state: EditorState, pos: number, alt: string): Transaction | null {
  return editCall(state, pos, (src) => withImageAlt(src, alt));
}

function editCall(state: EditorState, pos: number, change: (src: string) => string): Transaction | null {
  const image = locate(state, pos)?.image;
  if (!image) return null;
  const src = change(image.attrs.src);
  return src === image.attrs.src ? null : state.tr.setNodeAttribute(pos, 'src', src);
}
