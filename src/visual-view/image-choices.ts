/** Where the Visual view gets images to insert from: the host's project files. */
export interface ImageAssets {
  /** The project's images, as paths to write in `#image(..)` in this document. */
  list(): string[];
  /** Adds `file` to the project; resolves to the path to write in `#image(..)`, or null when it was not added. */
  upload(file: File): Promise<string | null>;
}

/**
 * The part of the "Insert image" popover that offers the project's images
 * (one button each) and an upload. Calls `choose` with the path to insert.
 */
export class ImageChoices {
  readonly element: HTMLElement;
  private readonly list: HTMLElement;

  constructor(
    doc: Document,
    private readonly assets: ImageAssets,
    private readonly choose: (path: string) => void,
  ) {
    this.element = doc.createElement('div');
    this.element.className = 'typst-popover__choices';
    this.list = doc.createElement('div');
    this.list.className = 'typst-popover__files';
    this.list.addEventListener('click', (event) => {
      const path = (event.target as HTMLElement).closest<HTMLElement>('[data-path]')?.dataset.path;
      if (path) choose(path);
    });
    const picker = doc.createElement('input');
    picker.type = 'file';
    picker.accept = 'image/*';
    picker.hidden = true;
    picker.addEventListener('change', () => {
      const file = picker.files?.[0];
      picker.value = '';
      if (file) void this.upload(file);
    });
    const upload = doc.createElement('button');
    upload.type = 'button';
    upload.textContent = 'Upload image…';
    upload.addEventListener('click', () => picker.click());
    this.element.append(this.list, upload, picker);
    this.refresh();
  }

  /** Lists the project's images as they are now. */
  refresh(): void {
    const doc = this.element.ownerDocument;
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

  private async upload(file: File): Promise<void> {
    const path = await this.assets.upload(file);
    if (path !== null) this.choose(path);
  }
}
