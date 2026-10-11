/**
 * The edits the image tools make to an image block (bare, or the body of a
 * figure), each one transaction, so one undo step: width and alt text. The
 * image call changes only in the argument concerned; the serializer prints
 * everything else of the block as it was. See ../images.ts.
 */
import type { Node } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { imageAlt, imageArg, withImageAlt, withImageWidth } from '../model/image-call';

/** What the image tools show for an image block. */
export interface ImageInfo {
  alt: string | null;
  /** The `width` argument as written. */
  width: string | null;
}

/** The image block at `pos`, if there is one. */
function imageAt(state: EditorState, pos: number): Node | null {
  const image = state.doc.nodeAt(pos);
  return image?.type.name === 'image' ? image : null;
}

/** What the image block at `pos` has; null if there is none. */
export function imageInfo(state: EditorState, pos: number): ImageInfo | null {
  const image = imageAt(state, pos);
  if (!image) return null;
  const src: string = image.attrs.src;
  return { alt: imageAlt(src), width: imageArg(src, 'width') };
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
  const image = imageAt(state, pos);
  if (!image) return null;
  const src = change(image.attrs.src);
  return src === image.attrs.src ? null : state.tr.setNodeAttribute(pos, 'src', src);
}
