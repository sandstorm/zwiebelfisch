// End-to-end tests (Playwright, against the demo build): "Download PDF" in the preview toolbar, with and without
// comments, and the exportPdf API.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from './fixtures';
import type { Download, Page } from '@playwright/test';

const DRAFTING = readFileSync(resolve(import.meta.dirname, '../../src/core/typst-engine/fixtures/drafting-0.2.2.tar.gz'));

test.beforeEach(async ({ page }) => {
  await page.route('https://packages.typst.org/preview/drafting-0.2.2.tar.gz', (route) =>
    route.fulfill({ body: DRAFTING, contentType: 'application/gzip' }));
  await page.goto('/');
  await expect(page.getByTestId('typst-preview').locator('.typst-preview__page svg').first()).toBeVisible();
});

const pdfControls = (page: Page) => page.getByTestId('typst-pdf');
const status = (page: Page) => pdfControls(page).getByRole('status');
type Editor = { source: string; exportPdf(options?: { comments?: boolean }): Promise<Blob> };
const setSource = (page: Page, text: string) =>
  page.evaluate((t) => ((window as unknown as { editor: Editor }).editor.source = t), text);

/** Starts a download with `click` and returns the file's name and bytes. */
async function download(page: Page, click: () => Promise<void>): Promise<{ name: string; bytes: Buffer }> {
  const [file] = await Promise.all([page.waitForEvent('download'), click()]) as [Download, void];
  return { name: file.suggestedFilename(), bytes: readFileSync((await file.path())!) };
}

test('"Download PDF" saves the PDF without comments; the menu offers both', async ({ page }) => {
  await setSource(page, [
    '#import "@preview/drafting:0.2.2": margin-note',
    '#set page(width: 16cm, height: auto, margin: (right: 4cm, rest: 1.5cm))',
    'Some #margin-note[text][A long note with many words in it, written in the margin] here.',
  ].join('\n'));

  const plain = await download(page, () => pdfControls(page).getByRole('button', { name: 'Download PDF' }).click());
  expect(plain.name).toBe('main.pdf');
  expect(plain.bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');

  await pdfControls(page).getByRole('button', { name: 'More PDF options' }).click();
  await expect(pdfControls(page).getByRole('menu')).toBeVisible();
  const noted = await download(page, () => pdfControls(page).getByRole('menuitem', { name: 'With comments' }).click());
  expect(noted.name).toBe('main-with-comments.pdf');
  expect(noted.bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  // the note's words are only in this one
  expect(noted.bytes.length).toBeGreaterThan(plain.bytes.length);

  await pdfControls(page).getByRole('button', { name: 'More PDF options' }).click();
  const final = await download(page, () => pdfControls(page).getByRole('menuitem', { name: 'Without comments' }).click());
  expect(final.name).toBe('main.pdf');
  await expect(status(page)).toHaveText('');
});

test('a document with errors gives a message, not a PDF', async ({ page }) => {
  await setSource(page, 'Text #oops');
  let downloads = 0;
  page.on('download', () => downloads++);
  await pdfControls(page).getByRole('button', { name: 'Download PDF' }).click();
  await expect(status(page)).toHaveText(/^No PDF: The document has 1 error: unknown variable: oops/);
  expect(downloads).toBe(0);
});

test('hosts get the PDF as a Blob from exportPdf', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const blob = await (window as unknown as { editor: Editor }).editor.exportPdf({ comments: true });
    return { type: blob.type, head: new TextDecoder().decode((await blob.arrayBuffer()).slice(0, 5)) };
  });
  expect(result).toEqual({ type: 'application/pdf', head: '%PDF-' });
});
