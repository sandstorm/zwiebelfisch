// PdfMenu: the preview toolbar's "Download PDF" button with its "Without / With comments" menu. See preview.ts.

/** A PDF to save: the file and the name to save it under. */
export interface PdfFile {
  blob: Blob;
  name: string;
}

/** Makes the PDF, with or without comments. Rejects with an error whose message is shown to the user. */
export type PdfSource = (comments: boolean) => Promise<PdfFile>;

const VARIANTS: [label: string, comments: boolean][] = [
  ['Without comments', false],
  ['With comments', true],
];

/**
 * "Download PDF" (the version without comments, the usual final one) and a
 * menu with both variants. While a PDF is being made the buttons are
 * disabled; a failure is shown next to them, and nothing is downloaded.
 */
export class PdfMenu {
  readonly element: HTMLElement;
  private readonly buttons: HTMLButtonElement[] = [];
  private readonly toggle: HTMLButtonElement;
  private readonly menu: HTMLElement;
  private readonly status: HTMLElement;

  constructor(private readonly doc: Document, private readonly source: PdfSource) {
    this.element = doc.createElement('span');
    this.element.className = 'typst-preview__pdf';
    this.element.dataset.testid = 'typst-pdf';
    const download = this.button('Download PDF', 'Download the PDF without comments');
    download.addEventListener('click', () => void this.download(false));
    this.toggle = this.button('▾', 'More PDF options');
    this.toggle.setAttribute('aria-label', 'More PDF options');
    this.toggle.setAttribute('aria-haspopup', 'menu');
    this.toggle.setAttribute('aria-expanded', 'false');
    this.toggle.addEventListener('click', () => this.open(this.menu.hidden));
    this.menu = doc.createElement('div');
    this.menu.className = 'typst-preview__pdf-menu';
    this.menu.setAttribute('role', 'menu');
    this.menu.hidden = true;
    for (const [label, comments] of VARIANTS) {
      const item = this.button(label, `Download the PDF ${label.toLowerCase()}`, this.menu);
      item.setAttribute('role', 'menuitem');
      item.addEventListener('click', () => {
        this.open(false);
        void this.download(comments);
      });
    }
    this.menu.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      this.open(false);
      this.toggle.focus();
    });
    this.status = doc.createElement('span');
    this.status.className = 'typst-preview__pdf-status';
    this.status.setAttribute('role', 'status');
    this.status.title = 'Click to dismiss';
    this.status.addEventListener('click', () => (this.status.textContent = ''));
    this.element.append(this.menu, this.status);
    doc.addEventListener('mousedown', this.closeOutside, true);
  }

  destroy(): void {
    this.doc.removeEventListener('mousedown', this.closeOutside, true);
    this.element.remove();
  }

  private button(label: string, title: string, parent: HTMLElement = this.element): HTMLButtonElement {
    const button = this.doc.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.title = title;
    parent.append(button);
    this.buttons.push(button);
    return button;
  }

  private open(open: boolean): void {
    this.menu.hidden = !open;
    this.toggle.setAttribute('aria-expanded', String(open));
    if (open) this.menu.querySelector('button')?.focus();
  }

  private readonly closeOutside = (event: MouseEvent): void => {
    if (!this.menu.hidden && !event.composedPath().includes(this.element)) this.open(false);
  };

  private async download(comments: boolean): Promise<void> {
    if (this.toggle.disabled) return;
    this.busy(true, 'Making PDF…');
    try {
      const { blob, name } = await this.source(comments);
      save(this.doc, blob, name);
      this.busy(false, '');
    } catch (error) {
      this.busy(false, `No PDF: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private busy(busy: boolean, status: string): void {
    for (const button of this.buttons) button.disabled = busy;
    this.status.textContent = status;
  }
}

/** Hands `blob` to the browser as a download named `name`. */
function save(doc: Document, blob: Blob, name: string): void {
  const link = doc.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  // the download has started from the URL by now; a later revoke is safe in every browser
  setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
}
