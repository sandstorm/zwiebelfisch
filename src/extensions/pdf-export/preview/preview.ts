// What the pdf-export extension adds to the preview: "Download PDF" and its options popover (downloadPdf).
// See pdfExport in ../pdf-export.ts.
import type { PdfExportOption, PreviewToolbarItem } from '../../../hosts/preview/preview';
import type { WindowApi } from '../../../hosts/window/window';
import type { Memento } from '../../../hosts/extension-host/extension-host';

/**
 * "Download PDF". With export options registered it opens a popover with a checkbox per option (as this viewer left
 * them last time, kept in `state` under `options`, else their defaults) and "Download"; without any it downloads at
 * once. While a PDF is being made the buttons are disabled ("Making PDF…"); a failure is an error message, and nothing
 * is downloaded.
 */
export function downloadPdf(pdfs: PdfDownloads, state: Memento, messages: PdfMessages): PreviewToolbarItem {
  return (preview) => {
    const button = new DownloadPdfButton(preview.ownerDocument, pdfs, state, messages);
    return { elements: [button.element], update: () => button.describe(), dispose: () => button.dispose() };
  };
}

/** What the button downloads: the PDF made with the given option values, and the name to save it under. */
export interface PdfDownloads {
  /** The options an export offers now (registered by other extensions). */
  options(): readonly PdfExportOption[];
  /** Rejects with an error whose message is shown to the user. */
  file(values: Record<string, boolean>): Promise<{ blob: Blob; name: string }>;
}

/** Where the button tells why there is no PDF. */
export type PdfMessages = Pick<WindowApi, 'showErrorMessage'>;

class DownloadPdfButton {
  readonly element: HTMLElement;
  private readonly download: HTMLButtonElement;
  private readonly popover: HTMLElement;
  private busy = false;

  constructor(
    private readonly doc: Document,
    private readonly pdfs: PdfDownloads,
    private readonly state: Memento,
    private readonly messages: PdfMessages,
  ) {
    this.element = doc.createElement('span');
    this.element.className = 'zwf-pdf-export';
    this.element.dataset.testid = 'zwf-pdf';
    this.download = this.button(LABEL);
    this.download.addEventListener('click', () => this.click());
    this.popover = doc.createElement('div');
    this.popover.className = 'zwf-pdf-export__options';
    this.popover.setAttribute('role', 'dialog');
    this.popover.setAttribute('aria-label', 'PDF options');
    this.popover.hidden = true;
    this.popover.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      this.open(false);
      this.download.focus();
    });
    this.element.append(this.download, this.popover);
    this.describe();
    doc.addEventListener('mousedown', this.closeOutside, true);
  }

  /** Tells whether the button opens options or downloads (options may be registered after the button). */
  describe(): void {
    const options = this.pdfs.options().length > 0;
    this.download.title = options ? 'Choose what the PDF includes, then download it' : 'Download the PDF';
    if (options) {
      this.download.setAttribute('aria-haspopup', 'dialog');
      this.download.setAttribute('aria-expanded', String(!this.popover.hidden));
    } else {
      this.download.removeAttribute('aria-haspopup');
      this.download.removeAttribute('aria-expanded');
    }
  }

  dispose(): void {
    this.doc.removeEventListener('mousedown', this.closeOutside, true);
    this.element.remove();
  }

  private click(): void {
    if (this.pdfs.options().length === 0) void this.makeAndSave({});
    else this.open(this.popover.hidden);
  }

  /** Opens the popover with the options registered now, or closes it. */
  private open(open: boolean): void {
    if (open) this.fill();
    this.popover.hidden = !open;
    this.describe();
    if (open) this.popover.querySelector('input')?.focus();
  }

  /** A checkbox per option, as this viewer left it last time (else its default), and "Download" with them. */
  private fill(): void {
    const remembered = this.remembered();
    const boxes = this.pdfs.options().map((option) => this.checkbox(option, remembered[option.id] ?? option.default));
    const download = this.button('Download');
    download.className = 'zwf-pdf-export__download';
    download.addEventListener('click', () => {
      const values = Object.fromEntries(boxes.map(({ id, input }) => [id, input.checked]));
      this.open(false);
      void this.makeAndSave(values);
    });
    this.popover.replaceChildren(...boxes.map(({ label }) => label), download);
  }

  private checkbox(option: PdfExportOption, checked: boolean): { id: string; label: HTMLLabelElement; input: HTMLInputElement } {
    const label = this.doc.createElement('label');
    const input = this.doc.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.addEventListener('change', () => void this.state.update(OPTIONS_KEY, { ...this.remembered(), [option.id]: input.checked }));
    if (option.description) label.title = option.description;
    label.append(input, option.label);
    return { id: option.id, label, input };
  }

  /** The values this viewer chose, read from storage: only booleans count. */
  private remembered(): Record<string, boolean> {
    const saved = this.state.get<unknown>(OPTIONS_KEY);
    if (typeof saved !== 'object' || saved === null) return {};
    return Object.fromEntries(Object.entries(saved).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'));
  }

  private button(label: string): HTMLButtonElement {
    const button = this.doc.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.disabled = this.busy;
    return button;
  }

  private readonly closeOutside = (event: MouseEvent): void => {
    if (!this.popover.hidden && !event.composedPath().includes(this.element)) this.open(false);
  };

  private async makeAndSave(values: Record<string, boolean>): Promise<void> {
    if (this.busy) return;
    this.setBusy(true);
    try {
      const { blob, name } = await this.pdfs.file(values);
      save(this.doc, blob, name);
    } catch (error) {
      void this.messages.showErrorMessage(`No PDF: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.setBusy(false);
    }
  }

  private setBusy(busy: boolean): void {
    this.busy = busy;
    for (const button of this.element.querySelectorAll('button')) button.disabled = busy;
    this.download.textContent = busy ? 'Making PDF…' : LABEL;
    this.download.setAttribute('aria-busy', String(busy));
  }
}

const LABEL = 'Download PDF';
/** Where the viewer's choices are kept. */
const OPTIONS_KEY = 'options';

/** Hands `blob` to the browser as a download named `name`. */
function save(doc: Document, blob: Blob, name: string): void {
  const link = doc.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  // the download has started from the URL by now; a later revoke is safe in every browser
  setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
}
