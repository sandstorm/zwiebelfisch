// @vitest-environment jsdom
// Tests for pdf-menu.ts.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PdfFile, PdfVariant, PreviewContext } from '../../../hosts/preview/preview';
import { pdfMenu } from './pdf-menu';

const fakePreview = (variants: PdfVariant[]) => ({ ownerDocument: document, pdfVariants: () => variants }) as Partial<PreviewContext> as PreviewContext;

/** Makes the PDF, with or without comments (the widget's two variants). */
type PdfSource = (comments: boolean) => Promise<PdfFile>;

describe('pdfMenu', () => {
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

  function setup(source: PdfSource) {
    const variants = [
      { label: 'Without comments', create: () => source(false) },
      { label: 'With comments', create: () => source(true) },
    ];
    const [element] = pdfMenu(fakePreview(variants)).elements;
    const menu = { element };
    document.body.append(element);
    const button = (name: string) =>
      [...menu.element.querySelectorAll('button')].find((b) => b.textContent === name || b.getAttribute('aria-label') === name)!;
    const status = () => menu.element.querySelector('[role="status"]')!.textContent;
    return { menu, button, status, items: () => menu.element.querySelector<HTMLElement>('[role="menu"]')! };
  }
  const file = (name: string) => ({ blob: new Blob(['%PDF-'], { type: 'application/pdf' }), name });

  it('downloads the PDF without comments from the plain button', async () => {
    const source = vi.fn(async (comments: boolean) => file(comments ? 'main-with-comments.pdf' : 'main.pdf'));
    const { button, status } = setup(source);
    button('Download PDF').click();
    await vi.waitFor(() => expect(saved).toEqual([{ name: 'main.pdf', href: 'blob:pdf' }]));
    expect(source).toHaveBeenCalledWith(false);
    expect(status()).toBe('');
  });

  it('offers both variants in a menu', async () => {
    const source = vi.fn(async (comments: boolean) => file(comments ? 'main-with-comments.pdf' : 'main.pdf'));
    const { button, items } = setup(source);
    const toggle = button('More PDF options');
    expect(items().hidden).toBe(true);
    toggle.click();
    expect(items().hidden).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect([...items().querySelectorAll('[role="menuitem"]')].map((i) => i.textContent)).toEqual(['Without comments', 'With comments']);
    button('With comments').click();
    expect(items().hidden).toBe(true);
    await vi.waitFor(() => expect(saved.map((s) => s.name)).toEqual(['main-with-comments.pdf']));
  });

  it('closes the menu with Escape and with a click elsewhere', () => {
    const { button, items } = setup(async () => file('x.pdf'));
    button('More PDF options').click();
    items().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(items().hidden).toBe(true);
    button('More PDF options').click();
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(items().hidden).toBe(true);
  });

  it('tells the user why there is no PDF, and downloads nothing', async () => {
    const { menu, button, status } = setup(async () => Promise.reject(new Error('The document has 1 error: unknown variable: oops')));
    button('Download PDF').click();
    await vi.waitFor(() => expect(status()).toBe('No PDF: The document has 1 error: unknown variable: oops'));
    expect(saved).toEqual([]);
    expect(button('Download PDF').disabled).toBe(false);
    menu.element.querySelector<HTMLElement>('[role="status"]')!.click();
    expect(status()).toBe('');
  });

  it('shows that a PDF is being made and ignores clicks meanwhile', async () => {
    let finish!: () => void;
    const source = vi.fn(() => new Promise<ReturnType<typeof file>>((resolve) => (finish = () => resolve(file('main.pdf')))));
    const { button, status } = setup(source);
    button('Download PDF').click();
    expect(status()).toBe('Making PDF…');
    expect(button('Download PDF').disabled).toBe(true);
    button('Download PDF').click();
    finish();
    await vi.waitFor(() => expect(saved).toHaveLength(1));
    expect(source).toHaveBeenCalledTimes(1);
    expect(status()).toBe('');
  });

  it('offers the variants registered by the time it opens, and names what the plain button makes', () => {
    const variants: PdfVariant[] = [];
    const item = pdfMenu(fakePreview(variants));
    const [element] = item.elements;
    document.body.append(element);
    variants.push({ label: 'Final', create: async () => file('final.pdf') });
    item.update!();
    expect(element.querySelector('button')!.title).toBe('Download the PDF final');
    element.querySelector<HTMLButtonElement>('[aria-label="More PDF options"]')!.click();
    expect([...element.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent)).toEqual(['Final']);
  });

  it('keeps the empty status in the page (no display: none), so a screen reader announces the messages put into it', () => {
    const css = readFileSync(resolve(import.meta.dirname, '../../../typst-editor/typst-editor.css'), 'utf8');
    expect(css).not.toMatch(/\.typst-preview__pdf-status[^{]*\{[^}]*display:\s*none/);
  });
});
