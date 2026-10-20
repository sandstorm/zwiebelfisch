// End-to-end tests (Playwright, against the demo build): "Download PDF" in the preview toolbar with its options
// popover ("Include comments"), and the command pdfExport.export for hosts.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from './fixtures';
import { expect, type Download, type Page } from '@playwright/test';

const DRAFTING = readFileSync(resolve(import.meta.dirname, '../../src/extensions/comments/model/fixtures/drafting-0.2.2.tar.gz'));

test.beforeEach(async ({ page }) => {
  await page.route('https://packages.typst.org/preview/drafting-0.2.2.tar.gz', (route) =>
    route.fulfill({ body: DRAFTING, contentType: 'application/gzip' }));
  await page.goto('/');
  await expect(page.getByTestId('zwf-preview').locator('.zwf-preview__page svg').first()).toBeVisible();
});

const pdfControls = (page: Page) => page.getByTestId('zwf-pdf');
/** The error messages shown ("No PDF: …"). */
const errors = (page: Page) => page.getByTestId('zwf-notifications').getByRole('alert');
type Editor = { source: string; executeCommand<T>(id: string, ...args: unknown[]): Promise<T> };
const setSource = (page: Page, text: string) =>
  page.evaluate((t) => ((window as unknown as { editor: Editor }).editor.source = t), text);

/** Starts a download with `click` and returns the file's name and bytes. */
async function download(page: Page, click: () => Promise<void>): Promise<{ name: string; bytes: Buffer }> {
  const [file] = await Promise.all([page.waitForEvent('download'), click()]) as [Download, void];
  return { name: file.suggestedFilename(), bytes: readFileSync((await file.path())!) };
}

/** Opens the options popover of "Download PDF" and returns it. */
async function openOptions(page: Page) {
  await pdfControls(page).getByRole('button', { name: 'Download PDF' }).click();
  const options = pdfControls(page).getByRole('dialog', { name: 'PDF options' });
  await expect(options).toBeVisible();
  return options;
}

test('"Download PDF" offers "Include comments" (off by default, remembered) and downloads', async ({ page }) => {
  await setSource(page, [
    '#import "@preview/drafting:0.2.2": margin-note',
    '#set page(width: 16cm, height: auto, margin: (right: 4cm, rest: 1.5cm))',
    'Some #margin-note[text][A long note with many words in it, written in the margin] here.',
  ].join('\n'));

  let options = await openOptions(page);
  await expect(options.getByRole('checkbox', { name: 'Include comments' })).not.toBeChecked();
  const plain = await download(page, () => options.getByRole('button', { name: 'Download', exact: true }).click());
  expect(plain.name).toBe('main.pdf');
  expect(plain.bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  await expect(options).toBeHidden();

  options = await openOptions(page);
  await options.getByRole('checkbox', { name: 'Include comments' }).check();
  const noted = await download(page, () => options.getByRole('button', { name: 'Download', exact: true }).click());
  expect(noted.name).toBe('main.pdf');
  expect(noted.bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  // the note's words are only in this one
  expect(noted.bytes.length).toBeGreaterThan(plain.bytes.length);

  // the choice is remembered for this viewer
  options = await openOptions(page);
  await expect(options.getByRole('checkbox', { name: 'Include comments' })).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(options).toBeHidden();
  await expect(errors(page)).toHaveCount(0);
});

test('a document with errors gives a message, not a PDF', async ({ page }) => {
  await setSource(page, 'Text #oops');
  let downloads = 0;
  page.on('download', () => downloads++);
  const options = await openOptions(page);
  await options.getByRole('button', { name: 'Download', exact: true }).click();
  await expect(errors(page)).toContainText(/No PDF: The document has 1 error: unknown variable: oops/);
  expect(downloads).toBe(0);
});

test('hosts get the PDF as a Blob from the command pdfExport.export', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const blob = await (window as unknown as { editor: Editor }).editor.executeCommand<Blob>('pdfExport.export', { 'comments.include': true });
    return { type: blob.type, head: new TextDecoder().decode((await blob.arrayBuffer()).slice(0, 5)) };
  });
  expect(result).toEqual({ type: 'application/pdf', head: '%PDF-' });
});
