// @vitest-environment jsdom
// Tests for preview.ts: "Download PDF" and its options popover.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PdfExportOption, PreviewContext } from '../../../hosts/preview/preview';
import type { Memento } from '../../../hosts/workbench/workbench';
import { downloadPdf, type PdfDownloads, type PdfMessages } from './preview';

const preview = { ownerDocument: document } as Partial<PreviewContext> as PreviewContext;

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

describe('downloadPdf', () => {
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
    const item = downloadPdf(pdfs, remembered, messages as PdfMessages)(preview);
    const [element] = item.elements;
    document.body.append(element);
    const button = (name: string) => [...element.querySelectorAll('button')].find((b) => b.textContent === name)!;
    const popover = () => element.querySelector<HTMLElement>('[role="dialog"]')!;
    const checkbox = (label: string) =>
      [...popover().querySelectorAll('label')].find((l) => l.textContent === label)!.querySelector('input')!;
    return { pdfs, item, element, button, popover, checkbox, errors, remembered };
  }

  it('downloads at once while no extension offers an option', async () => {
    const { pdfs, button, popover, errors } = setup([]);
    expect(button('Download PDF').hasAttribute('aria-haspopup')).toBe(false);
    button('Download PDF').click();
    await vi.waitFor(() => expect(saved).toEqual([{ name: 'main.pdf', href: 'blob:pdf' }]));
    expect(pdfs.file).toHaveBeenCalledWith({});
    expect(popover().hidden).toBe(true);
    expect(errors).toEqual([]);
  });

  it('opens a checkbox per option at its default, and downloads with the values checked', async () => {
    const { pdfs, button, popover, checkbox } = setup([include, toc]);
    expect(button('Download PDF').getAttribute('aria-haspopup')).toBe('dialog');
    button('Download PDF').click();
    expect(popover().hidden).toBe(false);
    expect(button('Download PDF').getAttribute('aria-expanded')).toBe('true');
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
    const { button, checkbox } = setup([include, toc], undefined, remembered);
    button('Download PDF').click();
    expect(checkbox('Table of contents').checked).toBe(false);
    checkbox('Include comments').click();
    expect(remembered.value).toEqual({ 'outline.toc': false, 'comments.include': true });
  });

  it('offers the options registered by the time it opens', () => {
    const options: PdfExportOption[] = [];
    const { item, button, popover } = setup(options);
    options.push(include);
    item.update!();
    expect(button('Download PDF').getAttribute('aria-haspopup')).toBe('dialog');
    button('Download PDF').click();
    expect(popover().querySelectorAll('input')).toHaveLength(1);
  });

  it('closes the popover with Escape, a second click and a click elsewhere', () => {
    const { button, popover } = setup([include]);
    button('Download PDF').click();
    popover().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(popover().hidden).toBe(true);
    button('Download PDF').click();
    button('Download PDF').click();
    expect(popover().hidden).toBe(true);
    button('Download PDF').click();
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(popover().hidden).toBe(true);
  });

  it('tells the user why there is no PDF (an error message), and downloads nothing', async () => {
    const { button, errors } = setup([], async () => Promise.reject(new Error('The document has 1 error: unknown variable: oops')));
    button('Download PDF').click();
    await vi.waitFor(() => expect(errors).toEqual(['No PDF: The document has 1 error: unknown variable: oops']));
    expect(saved).toEqual([]);
    expect(button('Download PDF').disabled).toBe(false);
  });

  it('shows that a PDF is being made and ignores clicks meanwhile', async () => {
    let finish!: () => void;
    const { pdfs, element, button } = setup([], () => new Promise((resolve) => (finish = () => resolve(file()))));
    button('Download PDF').click();
    const busy = element.querySelector('button')!;
    expect([busy.textContent, busy.disabled, busy.getAttribute('aria-busy')]).toEqual(['Making PDF…', true, 'true']);
    busy.click();
    finish();
    await vi.waitFor(() => expect(saved).toHaveLength(1));
    expect(pdfs.file).toHaveBeenCalledTimes(1);
    expect([busy.textContent, busy.disabled]).toEqual(['Download PDF', false]);
  });
});
