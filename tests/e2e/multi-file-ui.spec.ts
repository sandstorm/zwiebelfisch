import { test, expect } from './fixtures';

type Editor = HTMLElement & { value: string; files: Record<string, string | Uint8Array> };

test.beforeEach(async ({ page }) => {
  await page.goto('/examples/plain-html/');
  await expect(page.getByTestId('typst-preview').locator('.typst-preview__page svg')).toBeVisible();
});

test('a single-file widget shows no file bar', async ({ page }) => {
  await expect(page.locator('typst-editor').getByTestId('typst-files')).toBeHidden();
});

test('clicking text of another file in the preview opens that file; editing it updates the preview', async ({ page }) => {
  const editor = page.locator('typst-editor');
  const preview = editor.getByTestId('typst-preview');
  await editor.evaluate((el: Editor) => {
    el.files = { '/chapter1.typ': '#pagebreak()\nChapter text' };
    el.value = '#set page(width: 12cm, height: auto, margin: 1cm)\n= Main\n#include "chapter1.typ"';
  });
  const files = editor.getByTestId('typst-files');
  await expect(files).toBeVisible();
  await expect(preview.locator('.typst-preview__page')).toHaveCount(2);

  await editor.getByRole('tab', { name: 'Source' }).click();
  await preview.locator('.typst-preview__page').nth(1).locator('svg use').first().click();
  await expect(files.getByRole('tab', { name: /chapter1\.typ/ })).toHaveAttribute('aria-selected', 'true');
  const source = editor.locator('[data-testid=typst-source]:visible');
  await expect(source).toHaveCount(1);
  await expect(source.locator('.typst-source__jump')).toContainText('Chapter');

  await source.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('\n#pagebreak()\nThird page');
  await expect(preview.locator('.typst-preview__page')).toHaveCount(3);
  expect(await editor.evaluate((el: Editor) => el.files['/chapter1.typ'])).toContain('Third page');
});

test('creates and deletes a file from the file bar', async ({ page }) => {
  const editor = page.locator('typst-editor');
  await editor.evaluate((el: Editor) => {
    el.files = { '/notes.typ': 'Notes' };
  });
  const files = editor.getByTestId('typst-files');
  await files.getByRole('button', { name: 'New file' }).click();
  await editor.getByRole('textbox', { name: 'Name of the new file' }).fill('appendix');
  await editor.getByRole('button', { name: 'Create' }).click();
  await expect(files.getByRole('tab', { name: /appendix\.typ/ })).toHaveAttribute('aria-selected', 'true');

  await files.getByRole('button', { name: 'Delete' }).click();
  await editor.getByRole('button', { name: 'Delete', exact: true }).last().click();
  await expect(files.getByRole('tab', { name: /appendix\.typ/ })).toHaveCount(0);
  await expect(files.getByRole('tab', { name: /main\.typ/ })).toHaveAttribute('aria-selected', 'true');
});

test('the main file cannot be renamed or deleted', async ({ page }) => {
  const editor = page.locator('typst-editor');
  await editor.evaluate((el: Editor) => {
    el.files = { '/notes.typ': 'Notes' };
  });
  const files = editor.getByTestId('typst-files');
  await expect(files.getByRole('button', { name: 'Rename' })).toBeDisabled();
  await expect(files.getByRole('button', { name: 'Delete' })).toBeDisabled();
});

test('shows an image file and inserts it into the document', async ({ page }) => {
  const editor = page.locator('typst-editor');
  await editor.evaluate((el: Editor) => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>';
    el.files = { '/logo.svg': new TextEncoder().encode(svg) };
  });
  await editor.getByTestId('typst-files').getByRole('tab', { name: /logo\.svg/ }).click();
  const asset = editor.getByTestId('typst-asset');
  await expect(asset.locator('img')).toBeVisible();
  await asset.getByRole('button', { name: 'Insert into main.typ' }).click();
  await expect(asset).toBeHidden();
  expect(await editor.evaluate((el: Editor) => el.value)).toContain('#image("logo.svg")');
  await expect(editor.getByTestId('typst-preview').locator('.typst-preview__page image')).toHaveCount(1);
});
