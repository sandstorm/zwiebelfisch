// The images extension's model: image calls read and edited as source text, where an uploaded image goes, and which
// files are images (their media types).
// No DOM, no editor library. Entry of extensions/images/model/. See ../images.ts.
export { imageAlt, imageArg, imageWidthCss, withHash, withImageAlt, withImageWidth, withoutHash } from './image-call';
export { uploadTarget } from './upload';
export { IMAGE_FILES, imageBlob, isImage } from './image-files';
