// Image uploads: where "Insert image" gets the project's images from, and image files from the computer added to the
// project. See visual-view.ts.
import type { PathReference, ProjectPath } from '../../../core/paths/paths';

/** Where the Visual view gets images to insert from: the host's project files. */
export interface ImageAssets {
  /** The project's images, as paths to write in `#image(..)` in this document. */
  list(): PathReference[];
  /** Adds `file` to the project; resolves to the path to write in `#image(..)`, or why it was not added (in words for people). */
  upload(file: File): Promise<{ path: PathReference } | { error: string }>;
  /** The path to write in `#image(..)` in this document for the project file `path` (e.g. dragged from the file panel); null if it is no image. */
  reference(path: ProjectPath): PathReference | null;
}

/** Uploads `files` one by one: the paths of those added, and why the others were not. */
export async function uploadImages(assets: ImageAssets, files: readonly File[]): Promise<{ paths: PathReference[]; errors: string[] }> {
  const paths: PathReference[] = [];
  const errors: string[] = [];
  for (const file of files) {
    const result = await assets.upload(file);
    if ('path' in result) paths.push(result.path);
    else errors.push(result.error);
  }
  return { paths, errors };
}

/** A hidden file input for the image formats Typst can show; `pick` opens it, `choose` gets what was picked. */
export function imagePicker(doc: Document, choose: (files: File[]) => void): HTMLInputElement {
  const picker = doc.createElement('input');
  picker.type = 'file';
  // The formats Typst can show; others would only be refused after picking.
  picker.accept = '.png,.jpg,.jpeg,.gif,.svg,.webp';
  picker.multiple = true;
  picker.hidden = true;
  picker.dataset.testid = 'typst-image-picker';
  picker.addEventListener('change', () => {
    const files = [...(picker.files ?? [])];
    picker.value = '';
    if (files.length > 0) choose(files);
  });
  return picker;
}
