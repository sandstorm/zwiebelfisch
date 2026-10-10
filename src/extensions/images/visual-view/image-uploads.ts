// Image uploads: where "Insert image" gets the project's images from, and image files from the computer added to the
// project. See visual-view.ts.
import type { PathReference } from '../../../core/paths/paths';
import type { ImageAssets } from '../images';
import { IMAGE_ACCEPT } from '../model/image-files';

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

/** A hidden file input for the image formats Typst can show (others would only be refused after picking); `choose` gets what was picked. */
export function imagePicker(doc: Document, choose: (files: File[]) => void): HTMLInputElement {
  const picker = doc.createElement('input');
  picker.type = 'file';
  picker.accept = IMAGE_ACCEPT;
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
