// What the pdf-export extension adds to the preview: "Download PDF" and its options popover (PdfDownload).
// See pdfExport in ../pdf-export.ts.
import type { PdfExportOption } from '../../../hosts/preview/preview';
import type { WindowApi } from '../../../hosts/window/window';
import type { Memento } from '../../../hosts/extension-host/extension-host';

/**
 * "Download PDF" (`run`, the command `pdfExport.download`). With export options registered it opens a popover over
 * the top right of the preview (`element`, a pane overlay) with a checkbox per option (as this viewer left them last
 * time, kept in `state` under `options`, else their defaults) and "Download"; without any it downloads at once.
 * While a PDF is being made `busy` holds and the popover's buttons are disabled; a failure is an error message, and
 * nothing is downloaded.
 *
 * Escape, a press elsewhere and scrolling the preview close the popover; a press on its toolbar button
 * (`data-command="pdfExport.download"`) leaves it to `run`, which closes it again.
 */
export class PdfDownload {
  /** The popover, for `preview.registerPaneOverlay`; hidden while closed. */
  readonly element: HTMLElement;
  private making = false;
  /** What had the focus when the popover opened (the toolbar button), focused again on Escape. */
  private opener: HTMLElement | null = null;

  constructor(
    private readonly doc: Document,
    private readonly pdfs: PdfDownloads,
    private readonly state: Memento,
    private readonly messages: PdfMessages,
  ) {
    this.element = doc.createElement('div');
    this.element.className = 'zwf-pdf-export__options';
    this.element.dataset.testid = 'zwf-pdf-options';
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-label', 'PDF options');
    this.element.hidden = true;
    this.element.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      this.close();
      this.opener?.focus();
    });
    doc.addEventListener('mousedown', this.closeOutside, true);
  }

  /** Whether a PDF is being made. */
  get busy(): boolean {
    return this.making;
  }

  /** Downloads at once while there are no options, else opens the popover or closes it; resolves once that is done. */
  async run(): Promise<void> {
    if (this.pdfs.options().length === 0) return this.makeAndSave({});
    if (this.element.hidden) this.open();
    else this.close();
  }

  dispose(): void {
    this.doc.removeEventListener('mousedown', this.closeOutside, true);
    this.close();
  }

  /** Shows the popover with the options registered now, at the top of the preview as it is scrolled. */
  private open(): void {
    const root = this.element.getRootNode() as Document | ShadowRoot;
    this.opener = root.activeElement instanceof HTMLElement ? root.activeElement : null;
    this.fill();
    const scroller = this.element.parentElement;
    this.element.style.top = `${(scroller?.scrollTop ?? 0) + MARGIN}px`;
    scroller?.addEventListener('scroll', this.close, { passive: true });
    this.element.hidden = false;
    this.element.querySelector('input')?.focus();
  }

  private readonly close = (): void => {
    this.element.parentElement?.removeEventListener('scroll', this.close);
    this.element.hidden = true;
  };

  /** A checkbox per option, as this viewer left it last time (else its default), and "Download" with them. */
  private fill(): void {
    const remembered = this.remembered();
    const boxes = this.pdfs.options().map((option) => this.checkbox(option, remembered[option.id] ?? option.default));
    const download = this.doc.createElement('button');
    download.type = 'button';
    download.textContent = 'Download';
    download.className = 'zwf-pdf-export__download';
    download.disabled = this.making;
    download.addEventListener('click', () => {
      const values = Object.fromEntries(boxes.map(({ id, input }) => [id, input.checked]));
      this.close();
      void this.makeAndSave(values);
    });
    this.element.replaceChildren(...boxes.map(({ label }) => label), download);
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

  private readonly closeOutside = (event: MouseEvent): void => {
    if (this.element.hidden) return;
    const path = event.composedPath();
    const toolbarButton = path.some((target) => target instanceof HTMLElement && target.dataset.command === COMMAND);
    if (!path.includes(this.element) && !toolbarButton) this.close();
  };

  private async makeAndSave(values: Record<string, boolean>): Promise<void> {
    if (this.making) return;
    this.setMaking(true);
    try {
      const { blob, name } = await this.pdfs.file(values);
      save(this.doc, blob, name);
    } catch (error) {
      void this.messages.showErrorMessage(`No PDF: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.setMaking(false);
    }
  }

  private setMaking(making: boolean): void {
    this.making = making;
    for (const button of this.element.querySelectorAll('button')) button.disabled = making;
  }
}

/** What "Download PDF" downloads: the PDF made with the given option values, and the name to save it under. */
export interface PdfDownloads {
  /** The options an export offers now (registered by other extensions). */
  options(): readonly PdfExportOption[];
  /** Rejects with an error whose message is shown to the user. */
  file(values: Record<string, boolean>): Promise<{ blob: Blob; name: string }>;
}

/** Where "Download PDF" tells why there is no PDF. */
export type PdfMessages = Pick<WindowApi, 'showErrorMessage'>;

/** The command of "Download PDF". */
export const COMMAND = 'pdfExport.download';
/** Where the viewer's choices are kept. */
const OPTIONS_KEY = 'options';
/** Between the preview's top and the popover (px). */
const MARGIN = 4;

/** Hands `blob` to the browser as a download named `name`. */
function save(doc: Document, blob: Blob, name: string): void {
  const link = doc.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  // the download has started from the URL by now; a later revoke is safe in every browser
  setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
}
