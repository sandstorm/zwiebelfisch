// End-to-end tests (Playwright, against the demo build): the preview toolbar's View menu ("Page guides", "Box
// outlines") changes the preview's pages, is remembered, and leaves the PDF alone.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from './fixtures';
import { expect, type Page } from '@playwright/test';

/** scaffolder as `mise run build:packages` caches it (no network in the tests); skipped without it. */
const SCAFFOLDER = resolve(import.meta.dirname, '../../.cache/typst-packages/scaffolder-0.2.1.tar.gz');
/** The guides' stroke color, as the SVG of a page has it. */
const GUIDES = '#3b82f6';

test.skip(!existsSync(SCAFFOLDER), 'needs scaffolder: mise run build:packages');

test.beforeEach(async ({ page }) => {
  await page.route('https://packages.typst.org/preview/scaffolder-0.2.1.tar.gz', (route) =>
    route.fulfill({ body: readFileSync(SCAFFOLDER), contentType: 'application/gzip' }));
  await page.goto('/');
  await expect(firstPage(page).locator('svg')).toBeVisible();
});

const firstPage = (page: Page) => page.getByTestId('typst-preview').locator('.typst-preview__page').first();
const view = (page: Page) => page.getByTestId('typst-preview-view');
type Editor = { source: string; exportPdf(options?: Record<string, boolean>): Promise<Blob> };
const setSource = (page: Page, text: string) =>
  page.evaluate((t) => ((window as unknown as { editor: Editor }).editor.source = t), text);

async function openView(page: Page) {
  await view(page).getByRole('button', { name: 'View' }).click();
  const options = view(page).getByRole('dialog', { name: 'View options' });
  await expect(options).toBeVisible();
  return options;
}

test('"Page guides" draws the text area\'s borders in the preview, remembered, not in the PDF', async ({ page }) => {
  await setSource(page, '#set page(width: 12cm, height: 8cm, header: [Head])\n= Guides\nSome text.');
  await expect(firstPage(page).locator('svg')).toBeVisible();
  const pages = await page.getByTestId('typst-preview').locator('.typst-preview__page').count();
  expect(await firstPage(page).innerHTML()).not.toContain(GUIDES);

  let options = await openView(page);
  await expect(options.getByRole('checkbox', { name: 'Page guides' })).not.toBeChecked();
  await options.getByRole('checkbox', { name: 'Page guides' }).check();
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
  options = await openView(page);
  await expect(options.getByRole('checkbox', { name: 'Page guides' })).toBeChecked();
  await options.getByRole('checkbox', { name: 'Page guides' }).uncheck();
  await expect.poll(() => firstPage(page).innerHTML()).not.toContain(GUIDES);
  await page.keyboard.press('Escape');
  await expect(options).toBeHidden();
});

test('"Box outlines" outlines blocks and boxes, keeping a stroke the document gives', async ({ page }) => {
  await setSource(page, '#block(inset: 4pt, stroke: red)[Red]\n#box(inset: 2pt)[Box]');
  await expect(firstPage(page).locator('svg')).toBeVisible();
  const options = await openView(page);
  await options.getByRole('checkbox', { name: 'Box outlines' }).check();
  await expect.poll(() => firstPage(page).innerHTML()).toContain('#d946ef');
  expect(await firstPage(page).innerHTML()).toContain('#ff4136');
});
