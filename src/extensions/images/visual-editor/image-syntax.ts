// An image call's path: reading it from `#image("path", ..)` and writing a new call. See images in
// ../images.ts.
import { PathReference } from '../../../core/paths/paths';
import { decodeString, quote } from '../../../core/typst-syntax/typst-syntax';

/** The path of the image an `#image("path", ..)` call (or a figure's `image(..)`) shows; null if it is not a call with a literal path. */
export function imagePath(src: string): PathReference | null {
  const literal = /^#?image\(\s*("(?:[^"\\\n]|\\.)*")/.exec(src);
  const path = literal && decodeString(literal[1]);
  return path ? PathReference.of(path) : null;
}

/** The source of an image block showing the image at `path`. */
export function imageSource(path: PathReference): string {
  return `#image(${quote(path)})`;
}
