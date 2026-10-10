// @vitest-environment jsdom
// Tests for pdf-menu.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PdfMenu, type PdfSource } from './pdf-menu';

describe('PdfMenu', () => {
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
    const menu = new PdfMenu(document, source);
    document.body.append(menu.element);
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
});
