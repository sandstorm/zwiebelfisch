// Image choices: the project's images offered in the "Insert image" popover, and uploads. See images.ts.
import { PathReference, type ProjectPath } from '../../../core/paths/paths';

/** Where the Visual view gets images to insert from: the host's project files. */
export interface ImageAssets {
  /** The project's images, as paths to write in `#image(..)` in this document. */
  list(): PathReference[];
  /** Adds `file` to the project; resolves to the path to write in `#image(..)`, or why it was not added (in words for people). */
  upload(file: File): Promise<{ path: PathReference } | { error: string }>;
  /** The path to write in `#image(..)` in this document for the project file `path` (e.g. dragged from the file panel); null if it is no image. */
  reference(path: ProjectPath): PathReference | null;
}

/**
 * The part of the "Insert image" popover that offers the project's images
 * (one button each) and an upload. Calls `choose` with the paths to insert,
 * and shows why an upload was not added.
 */
export class ImageChoices {
  readonly element: HTMLElement;
  private readonly list: HTMLElement;
  private readonly error: HTMLElement;

  constructor(
    doc: Document,
    private readonly assets: ImageAssets,
    private readonly choose: (paths: PathReference[], near?: number) => void,
  ) {
    this.element = doc.createElement('div');
    this.element.className = 'typst-popover__choices';
    this.list = doc.createElement('div');
    this.list.className = 'typst-popover__files';
    this.list.addEventListener('click', (event) => {
      const path = (event.target as HTMLElement).closest<HTMLElement>('[data-path]')?.dataset.path;
      if (path) choose([PathReference.of(path)]);
    });
    const picker = doc.createElement('input');
    picker.type = 'file';
    // The formats Typst can show; others would only be refused after picking.
    picker.accept = '.png,.jpg,.jpeg,.gif,.svg,.webp';
    picker.hidden = true;
    picker.addEventListener('change', () => {
      const file = picker.files?.[0];
      picker.value = '';
      if (file) void this.upload([file]);
    });
    const upload = doc.createElement('button');
    upload.type = 'button';
    upload.textContent = 'Upload image…';
    upload.addEventListener('click', () => picker.click());
    this.error = doc.createElement('span');
    this.error.className = 'typst-popover__error';
    this.error.setAttribute('role', 'alert');
    this.element.append(this.list, upload, picker, this.error);
    this.refresh();
  }

  /** Lists the project's images as they are now, and forgets an earlier upload error. */
  refresh(): void {
    const doc = this.element.ownerDocument;
    this.error.textContent = '';
    this.list.replaceChildren(
      ...this.assets.list().map((path) => {
        const button = doc.createElement('button');
        button.type = 'button';
        button.dataset.path = path;
        button.textContent = path;
        return button;
      }),
    );
  }

  /**
   * Uploads `files` one by one, then chooses those that were added (to go
   * near document position `near`, if given). Resolves to false when it
   * shows why one was not added.
   */
  async upload(files: File[], near?: number): Promise<boolean> {
    this.error.textContent = '';
    const paths: PathReference[] = [];
    for (const file of files) {
      const result = await this.assets.upload(file);
      if ('path' in result) paths.push(result.path);
      else this.error.textContent = result.error;
    }
    if (paths.length > 0) this.choose(paths, near);
    return this.error.textContent === '';
  }
}
