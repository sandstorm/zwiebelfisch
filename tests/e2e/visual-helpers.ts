// Helpers for the Visual view specs: locators and source text.
import type { Locator, Page } from '@playwright/test';
import { expect } from './fixtures';

/** The Visual view's editing area. */
export const visual = (page: Page) => page.getByTestId('typst-visual');

/** The Visual view's formatting toolbar. */
export const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Formatting' });

/** Opens the toolbar menu `menu` ("Insert", "Align") of the toolbar `bar` and chooses `item` in it. */
export async function chooseFrom(bar: Locator, menu: 'Insert' | 'Align', item: string): Promise<void> {
  await bar.getByRole('button', { name: menu, exact: true }).click();
  await bar.getByRole('menuitem', { name: item, exact: true }).click();
}

/** The bar of bold, italic, code, link (and comment) floating above the text selection. */
export const selectionBar = (page: Page) => page.getByRole('toolbar', { name: 'Selection' });

/** The bar of table edits (rows, columns, header row) floating above the table holding the cursor. */
export const tableBar = (page: Page) => page.getByRole('toolbar', { name: 'Table' });

/** The main file's text, from the demo's editor API (CodeMirror renders lines as separate elements). */
export const sourceText = (page: Page) => () =>
  page.evaluate(() => (window as unknown as { editor: { source: string } }).editor.source);

/** The text selected in the page (what the user sees highlighted). */
export const selectedText = (page: Page) => () => page.evaluate(() => window.getSelection()?.toString() ?? '');

/** Waits until the preview shows the first compiled page, i.e. the widget has finished starting up. */
export async function compiled(page: Page): Promise<void> {
  await expect(page.getByTestId('typst-preview').locator('.typst-preview__page svg').first()).toBeVisible();
}

/**
 * Clicks into `block` (a paragraph or heading of the Visual view) and puts
 * the caret at its very end.
 *
 * Not `End`: that goes to the end of the visual line, and the demo's first
 * paragraph wraps, with its centre (where Playwright clicks) right on the
 * line boundary (Chromium lands on line 2, Firefox on line 1). And not right
 * after the click: 20 ms after the editor gains focus, ProseMirror writes its
 * own selection back to the DOM unless it has seen the DOM selection by then,
 * undoing a caret move made in between. Returns once ProseMirror has seen
 * the new caret (its `selectionchange` listener runs before the one here), so
 * toolbar clicks, which do not read the DOM selection, act on it.
 */
export async function caretAtEnd(block: Locator): Promise<void> {
  await clickAndSettle(block);
  await block.evaluate(async (element) => {
    const doc = element.ownerDocument;
    const seen = new Promise((resolve) => {
      doc.addEventListener('selectionchange', resolve, { once: true });
      setTimeout(resolve, 200); // the caret was there already: no event
    });
    const selection = doc.getSelection()!;
    selection.selectAllChildren(element);
    selection.collapseToEnd();
    await seen;
  });
}

/**
 * Clicks into `block` and selects the first occurrence of `text` in it (within
 * one text node), then waits until ProseMirror has seen the selection (as
 * `caretAtEnd`). Not Home + arrow keys: Home is no line start in Firefox and
 * WebKit on macOS.
 */
export async function selectText(block: Locator, text: string): Promise<void> {
  await clickAndSettle(block);
  await block.evaluate(async (element, text) => {
    const doc = element.ownerDocument;
    const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode()) && !node.textContent!.includes(text));
    if (!node) throw new Error(`no text "${text}"`);
    const start = node.textContent!.indexOf(text);
    const seen = new Promise((resolve) => {
      doc.addEventListener('selectionchange', resolve, { once: true });
      setTimeout(resolve, 200);
    });
    doc.getSelection()!.setBaseAndExtent(node, start, node, start + text.length);
    await seen;
  }, text);
}

/**
 * Clicks `target` in the Visual view and waits out ProseMirror's 20 ms focus
 * timer (see `caretAtEnd`), so caret keys pressed next (Home, arrows) are not
 * undone halfway through by ProseMirror writing its own selection back.
 */
export async function clickAndSettle(target: Locator): Promise<void> {
  await target.click();
  await target.evaluate(() => new Promise((resolve) => setTimeout(resolve, 25)));
}

/** Adds a new paragraph "Fresh line" after the first paragraph and selects it. */
export async function freshSelectedLine(page: Page): Promise<void> {
  await caretAtEnd(visual(page).locator('p').first());
  await page.keyboard.press('Enter');
  await page.keyboard.type('Fresh line');
  // Shift+Home does not select to the line start in every browser/OS keymap (Chromium on macOS:
  // nothing, Firefox on macOS: to the document start); extend the selection explicitly.
  for (let i = 0; i < 'Fresh line'.length; i++) await page.keyboard.press('Shift+ArrowLeft');
  await expect.poll(selectedText(page)).toBe('Fresh line');
  // ProseMirror reads the DOM selection on `selectionchange`, after the DOM has it: commands run
  // right now (Mod+K) could still see part of it (Chromium linked "h line")
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 20))));
}

/**
 * Clicks the first glyph of the preview's first page (the "H" of the demo's heading).
 *
 * Not `use.click()`: a glyph is a `<use>` of a `<symbol>` without a size, and
 * Firefox reports such a `<use>` as large as the whole page, so Playwright
 * would aim at the page centre. The point is computed from the glyph's origin
 * in the SVG instead: 3 pt right of it and 4 pt above the baseline.
 */
export async function clickFirstGlyph(page: Page): Promise<void> {
  const glyph = page.getByTestId('typst-preview').locator('.typst-preview__page svg').first().locator('use').first();
  const point = await glyph.evaluate((use: SVGUseElement) => {
    // Typst draws text runs flipped (`matrix(1 0 0 -1 …)`), so "above the baseline" is +y here.
    const local = new DOMPoint(use.x.baseVal.value + 3, use.y.baseVal.value + 4);
    const client = local.matrixTransform((use.parentNode as SVGGraphicsElement).getScreenCTM()!);
    return { x: client.x, y: client.y };
  });
  await page.mouse.click(point.x, point.y);
}
