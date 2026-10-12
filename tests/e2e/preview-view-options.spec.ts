// End-to-end tests (Playwright, against the demo build): the preview's view options in the View menu at the top right
// of the editing area ("Comments", "Page guides", "Box outlines", "Block spacing") change the preview's pages, are remembered, and
// leave the PDF and the Visual editor alone.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from './fixtures';
import { expect, type Page } from '@playwright/test';

/** The guides' stroke color, as the SVG of a page has it. */
const GUIDES = '#3b82f6';
const DRAFTING = readFileSync(resolve(import.meta.dirname, '../../src/extensions/comments/model/fixtures/drafting-0.2.2.tar.gz'));

test.beforeEach(async ({ page }) => {
  // the demo has a margin note: its package comes from the test fixture, not from packages.typst.org
  await page.route('https://packages.typst.org/preview/drafting-0.2.2.tar.gz', (route) => route.fulfill({ body: DRAFTING, contentType: 'application/gzip' }));
  await page.goto('/');
  await expect(firstPage(page).locator('svg')).toBeVisible();
});

const firstPage = (page: Page) => page.getByTestId('typst-preview').locator('.typst-preview__page').first();
type Editor = { source: string; exportPdf(options?: Record<string, boolean>): Promise<Blob> };
const setSource = (page: Page, text: string) =>
  page.evaluate((t) => ((window as unknown as { editor: Editor }).editor.source = t), text);

/** Opens "View" in the tab bar; the menu's checkbox entry `name`. */
async function viewEntry(page: Page, name: string) {
  await page.getByRole('toolbar', { name: 'Editor actions' }).getByRole('button', { name: 'View', exact: true }).click();
  const menu = page.getByRole('menu', { name: 'View' });
  await expect(menu).toBeVisible();
  return menu.getByRole('menuitemcheckbox', { name });
}

test('the View menu lists the editors\' options, then the preview\'s', async ({ page }) => {
  await viewEntry(page, 'Comments');
  const menu = page.getByRole('menu', { name: 'View' });
  await expect(menu.getByRole('menuitemcheckbox')).toHaveText([/Invisible characters/, /Comments/, /Page guides/, /Box outlines/, /Block spacing/]);
  await expect(menu.getByRole('separator')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
});

test('"Page guides" draws the text area\'s borders in the preview, remembered, not in the PDF', async ({ page }) => {
  await setSource(page, '#set page(width: 12cm, height: 8cm, header: [Head])\n= Guides\nSome text.');
  await expect(firstPage(page).locator('svg')).toBeVisible();
  const pages = await page.getByTestId('typst-preview').locator('.typst-preview__page').count();
  expect(await firstPage(page).innerHTML()).not.toContain(GUIDES);

  let guides = await viewEntry(page, 'Page guides');
  await expect(guides).not.toBeChecked();
  await guides.click();
  await expect.poll(() => firstPage(page).innerHTML()).toContain(GUIDES);
  await expect(page.getByTestId('typst-preview').locator('.typst-preview__page')).toHaveCount(pages);
  // the PDF is still made (the export compiles the main file itself)
  const pdf = await page.evaluate(async () => {
    const blob = await (window as unknown as { editor: Editor }).editor.exportPdf();
    return new Uint8Array(await blob.arrayBuffer()).length;
  });
  expect(pdf).toBeGreaterThan(0);

  // remembered for this viewer
  await page.reload();
  await expect.poll(() => firstPage(page).innerHTML()).toContain(GUIDES);
  guides = await viewEntry(page, 'Page guides');
  await expect(guides).toBeChecked();
  await guides.click();
  await expect.poll(() => firstPage(page).innerHTML()).not.toContain(GUIDES);
});

test('"Box outlines" outlines blocks and boxes, keeping a stroke the document gives', async ({ page }) => {
  await setSource(page, '#block(inset: 4pt, stroke: red)[Red]\n#box(inset: 2pt)[Box]');
  await expect(firstPage(page).locator('svg')).toBeVisible();
  await (await viewEntry(page, 'Box outlines')).click();
  await expect.poll(() => firstPage(page).innerHTML()).toContain('#d946ef');
  expect(await firstPage(page).innerHTML()).toContain('#ff4136');
});

/** How many glyphs the first preview page draws in the demo's note margin (the last 4cm of 16cm). */
const marginGlyphs = (page: Page) => () =>
  firstPage(page).locator('svg').evaluate((svg) => {
    const box = svg.getBoundingClientRect();
    const margin = box.left + box.width * (1 - 4 / 16);
    return [...svg.querySelectorAll('use')].filter((glyph) => glyph.getBoundingClientRect().left >= margin).length;
  });

test('"Comments" off hides the margin notes in the preview only, remembered', async ({ page }) => {
  await expect.poll(marginGlyphs(page)).toBeGreaterThan(0);
  const comments = await viewEntry(page, 'Comments');
  await expect(comments).toBeChecked();
  await comments.click();
  await expect.poll(marginGlyphs(page)).toBe(0);
  // the Visual editor keeps its notes
  await expect(page.getByTestId('typst-note-card')).not.toHaveCount(0);

  await page.reload();
  await expect(firstPage(page).locator('svg')).toBeVisible();
  await expect.poll(marginGlyphs(page)).toBe(0);
  await (await viewEntry(page, 'Comments')).click();
  await expect.poll(marginGlyphs(page)).toBeGreaterThan(0);
});
