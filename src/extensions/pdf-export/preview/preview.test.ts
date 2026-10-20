// @vitest-environment jsdom
// Tests for preview.ts: "Download PDF" and its options popover.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PdfExportOption } from '../../../hosts/preview/preview';
import type { Memento } from '../../../hosts/extension-host/extension-host';
import { PdfDownload, type PdfDownloads, type PdfMessages } from './preview';

const include: PdfExportOption = { id: 'comments.include', label: 'Include comments', description: 'The notes', default: false, apply: (e) => e };
const toc: PdfExportOption = { id: 'outline.toc', label: 'Table of contents', default: true, apply: (e) => e };

/** A Memento holding the value of `options` in a variable (`undefined`: nothing saved). */
function memory(initial?: Record<string, boolean>): Memento & { value: unknown } {
  const store = {
    value: initial as unknown,
    keys: () => (store.value === undefined ? [] : ['options']),
    get: (key: string, fallback?: unknown) => (key === 'options' && store.value !== undefined ? store.value : fallback),
    update: async (_key: string, value: unknown) => void (store.value = value),
  };
  return store as Memento & { value: unknown };
}

describe('PdfDownload', () => {
  let saved: { name: string; href: string }[];
  beforeEach(() => {
    saved = [];
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:pdf'), revokeObjectURL: vi.fn() }));
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      saved.push({ name: this.download, href: this.href });
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  const file = (name = 'main.pdf') => ({ blob: new Blob(['%PDF-'], { type: 'application/pdf' }), name });

  function setup(options: PdfExportOption[], make: PdfDownloads['file'] = async () => file(), remembered = memory()) {
    const pdfs = { options: () => options, file: vi.fn(make) };
    const errors: string[] = [];
    const messages = { showErrorMessage: async (message: string) => (errors.push(message), undefined) };
    const download = new PdfDownload(document, pdfs, remembered, messages as PdfMessages);
    // the pane's scroll area, as registerPaneOverlay puts it there
    const scroller = document.body.appendChild(document.createElement('div'));
    scroller.append(download.element);
    const popover = () => download.element;
    const button = (name: string) => [...popover().querySelectorAll('button')].find((b) => b.textContent === name)!;
    const checkbox = (label: string) =>
      [...popover().querySelectorAll('label')].find((l) => l.textContent === label)!.querySelector('input')!;
    return { pdfs, download, scroller, button, popover, checkbox, errors, remembered };
  }

  it('downloads at once while no extension offers an option', async () => {
    const { pdfs, download, popover, errors } = setup([]);
    await download.run();
    expect(saved).toEqual([{ name: 'main.pdf', href: 'blob:pdf' }]);
    expect(pdfs.file).toHaveBeenCalledWith({});
    expect(popover().hidden).toBe(true);
    expect(errors).toEqual([]);
  });

  it('opens a checkbox per option at its default, and downloads with the values checked', async () => {
    const { pdfs, download, scroller, button, popover, checkbox } = setup([include, toc]);
    scroller.scrollTop = 0;
    void download.run();
    expect(popover().hidden).toBe(false);
    expect(popover().style.top).toBe('4px');
    expect([...popover().querySelectorAll('label')].map((l) => l.textContent)).toEqual(['Include comments', 'Table of contents']);
    expect(popover().querySelector('label')!.title).toBe('The notes');
    expect(checkbox('Include comments').checked).toBe(false);
    expect(checkbox('Table of contents').checked).toBe(true);
    checkbox('Include comments').click();
    button('Download').click();
    expect(popover().hidden).toBe(true);
    await vi.waitFor(() => expect(saved).toHaveLength(1));
    expect(pdfs.file).toHaveBeenCalledWith({ 'comments.include': true, 'outline.toc': true });
  });

  it('remembers the choices for this viewer and shows them next time', () => {
    const remembered = memory({ 'outline.toc': false, junk: 'x' as unknown as boolean });
    const { download, checkbox } = setup([include, toc], undefined, remembered);
    void download.run();
    expect(checkbox('Table of contents').checked).toBe(false);
    checkbox('Include comments').click();
    expect(remembered.value).toEqual({ 'outline.toc': false, 'comments.include': true });
  });

  it('offers the options registered by the time it opens', () => {
    const options: PdfExportOption[] = [];
    const { download, popover } = setup(options);
    options.push(include);
    void download.run();
    expect(popover().querySelectorAll('input')).toHaveLength(1);
  });

  it('closes the popover with Escape, running it again, a press elsewhere and a scroll; not on a press on its toolbar button', () => {
    const { download, scroller, popover } = setup([include]);
    void download.run();
    popover().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(popover().hidden).toBe(true);
    void download.run();
    const toolbarButton = document.body.appendChild(Object.assign(document.createElement('button'), { textContent: 'Download PDF' }));
    toolbarButton.dataset.command = 'pdfExport.download';
    toolbarButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(popover().hidden).toBe(false);
    void download.run();
    expect(popover().hidden).toBe(true);
    void download.run();
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(popover().hidden).toBe(true);
    void download.run();
    scroller.dispatchEvent(new Event('scroll'));
    expect(popover().hidden).toBe(true);
  });

  it('tells the user why there is no PDF (an error message), and downloads nothing', async () => {
    const { download, errors } = setup([], async () => Promise.reject(new Error('The document has 1 error: unknown variable: oops')));
    await download.run();
    expect(errors).toEqual(['No PDF: The document has 1 error: unknown variable: oops']);
    expect(saved).toEqual([]);
    expect(download.busy).toBe(false);
  });

  it('is busy while a PDF is being made, its Download disabled, and ignores runs meanwhile', async () => {
    let finish!: () => void;
    const options: PdfExportOption[] = [];
    const { pdfs, download, button } = setup(options, () => new Promise((resolve) => (finish = () => resolve(file()))));
    const made = download.run();
    expect(download.busy).toBe(true);
    void download.run();
    options.push(include);
    void download.run();
    expect(button('Download').disabled).toBe(true);
    finish();
    await made;
    expect(saved).toHaveLength(1);
    expect(pdfs.file).toHaveBeenCalledTimes(1);
    expect([download.busy, button('Download').disabled]).toEqual([false, false]);
  });
});
