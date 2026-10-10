// pdfMenu: the preview toolbar's "Download PDF" button with a menu of the registered PDF variants. See ../pdf-export.ts.
import type { PdfVariant, PreviewToolbarItem } from '../../../hosts/preview/preview';

/**
 * "Download PDF" (the first registered PDF variant, e.g. the version without comments, the usual final
 * one) and a menu with every variant. While a PDF is being made the buttons are disabled; a failure is
 * shown next to them, and nothing is downloaded.
 */
export const pdfMenu: PreviewToolbarItem = (preview) => {
  const menu = new PdfMenu(preview.ownerDocument, () => preview.pdfVariants());
  return { elements: [menu.element], update: () => menu.describe(), dispose: () => menu.destroy() };
};

class PdfMenu {
  readonly element: HTMLElement;
  private readonly download: HTMLButtonElement;
  private readonly toggle: HTMLButtonElement;
  private readonly menu: HTMLElement;
  private readonly status: HTMLElement;
  private busy = false;

  constructor(
    private readonly doc: Document,
    private readonly variants: () => readonly PdfVariant[],
  ) {
    this.element = doc.createElement('span');
    this.element.className = 'typst-preview__pdf';
    this.element.dataset.testid = 'typst-pdf';
    this.download = this.button('Download PDF', this.element);
    this.download.addEventListener('click', () => void this.makeAndSave(this.variants()[0]));
    this.toggle = this.button('▾', this.element);
    this.toggle.title = 'More PDF options';
    this.toggle.setAttribute('aria-label', 'More PDF options');
    this.toggle.setAttribute('aria-haspopup', 'menu');
    this.toggle.setAttribute('aria-expanded', 'false');
    this.toggle.addEventListener('click', () => this.open(this.menu.hidden));
    this.menu = doc.createElement('div');
    this.menu.className = 'typst-preview__pdf-menu';
    this.menu.setAttribute('role', 'menu');
    this.menu.hidden = true;
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
    this.describe();
    doc.addEventListener('mousedown', this.closeOutside, true);
  }

  /** Names what the plain button downloads (variants may be registered after the menu). */
  describe(): void {
    const first = this.variants()[0];
    this.download.title = first ? `Download the PDF ${first.label.toLowerCase()}` : 'Download the PDF';
  }

  destroy(): void {
    this.doc.removeEventListener('mousedown', this.closeOutside, true);
    this.element.remove();
  }

  private button(label: string, parent: HTMLElement): HTMLButtonElement {
    const button = this.doc.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.disabled = this.busy;
    parent.append(button);
    return button;
  }

  /** Opens the menu with the variants registered now, or closes it. */
  private open(open: boolean): void {
    if (open) this.menu.replaceChildren(...this.variants().map((variant) => this.item(variant)));
    this.menu.hidden = !open;
    this.toggle.setAttribute('aria-expanded', String(open));
    if (open) this.menu.querySelector('button')?.focus();
  }

  private item(variant: PdfVariant): HTMLButtonElement {
    const item = this.button(variant.label, this.menu);
    item.title = `Download the PDF ${variant.label.toLowerCase()}`;
    item.setAttribute('role', 'menuitem');
    item.addEventListener('click', () => {
      this.open(false);
      void this.makeAndSave(variant);
    });
    return item;
  }

  private readonly closeOutside = (event: MouseEvent): void => {
    if (!this.menu.hidden && !event.composedPath().includes(this.element)) this.open(false);
  };

  private async makeAndSave(variant: PdfVariant | undefined): Promise<void> {
    if (this.busy || !variant) return;
    this.setBusy(true, 'Making PDF…');
    try {
      const { blob, name } = await variant.create();
      save(this.doc, blob, name);
      this.setBusy(false, '');
    } catch (error) {
      this.setBusy(false, `No PDF: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private setBusy(busy: boolean, status: string): void {
    this.busy = busy;
    for (const button of this.element.querySelectorAll('button')) button.disabled = busy;
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
