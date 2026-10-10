// End-to-end tests (Playwright, against the demo build): the file panel (multi-file projects).
import { expect } from '@playwright/test';
import { test, clickGlyph, fileRow } from './fixtures';

type Editor = HTMLElement & { value: string; files: Record<string, string | Uint8Array> };

test.beforeEach(async ({ page }) => {
  await page.goto('/examples/plain-html/');
  await expect(page.getByTestId('typst-preview').locator('.typst-preview__page svg')).toBeVisible();
});

test('a single-file widget keeps the file panel collapsed to its rail button', async ({ page }) => {
  const editor = page.locator('typst-editor');
  await expect(editor.getByTestId('typst-files')).toBeHidden();
  await editor.getByTestId('typst-panel-toggle-files').click();
  await expect(fileRow(editor, 'main.typ')).toHaveAttribute('aria-selected', 'true');
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
  // the first glyph of the second page is the "C" of "Chapter text" in chapter1.typ
  await clickGlyph(preview.locator('.typst-preview__page').nth(1).locator('svg use').first());
  await expect(fileRow(editor, 'chapter1.typ')).toHaveAttribute('aria-selected', 'true');
  const source = editor.locator('[data-testid=typst-source]:visible');
  await expect(source).toHaveCount(1);
  await expect(source.locator('.typst-source__jump')).toContainText('Chapter');

  await source.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('\n#pagebreak()\nThird page');
  await expect(preview.locator('.typst-preview__page')).toHaveCount(3);
  expect(await editor.evaluate((el: Editor) => el.files['/chapter1.typ'])).toContain('Third page');
});

test('creates and deletes a file from the file panel', async ({ page }) => {
  const editor = page.locator('typst-editor');
  await editor.evaluate((el: Editor) => {
    el.files = { '/notes.typ': 'Notes' };
  });
  const files = editor.getByTestId('typst-files');
  await files.getByRole('button', { name: 'New', exact: true }).click();
  await editor.getByRole('menu', { name: 'New' }).getByRole('menuitem', { name: 'New file…' }).click();
  await editor.getByRole('textbox', { name: 'Name of the new file' }).fill('appendix');
  await editor.getByRole('textbox', { name: 'Name of the new file' }).press('Enter');
  await expect(fileRow(editor, 'appendix.typ')).toHaveAttribute('aria-selected', 'true');

  // the row's context menu, then the confirmation (a warning message)
  await fileRow(editor, 'appendix.typ').click({ button: 'right' });
  await editor.getByRole('menuitem', { name: 'Delete' }).click();
  const confirmation = editor.getByTestId('typst-notifications').getByRole('alert').filter({ hasText: 'Delete appendix.typ?' });
  await confirmation.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(fileRow(editor, 'appendix.typ')).toHaveCount(0);
  await expect(fileRow(editor, 'main.typ')).toHaveAttribute('aria-selected', 'true');
});

test('the main file cannot be renamed or deleted', async ({ page }) => {
  const editor = page.locator('typst-editor');
  await editor.evaluate((el: Editor) => {
    el.files = { '/notes.typ': 'Notes' };
  });
  await fileRow(editor, 'main.typ').click({ button: 'right' });
  const menu = editor.getByRole('menu', { name: 'main.typ' });
  await expect(menu.getByRole('menuitem', { name: 'New file…' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Rename…' })).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: 'Delete' })).toHaveCount(0);
});

test('shows an image file; dragged from the file panel into the text, it is inserted there', async ({ page }) => {
  const editor = page.locator('typst-editor');
  await editor.evaluate((el: Editor) => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>';
    el.files = { '/logo.svg': new TextEncoder().encode(svg) };
  });
  await fileRow(editor, 'logo.svg').click();
  const asset = editor.getByTestId('typst-asset');
  await expect(asset.locator('img')).toBeVisible();
  await expect(asset.getByRole('button')).toHaveCount(0); // no "Insert into …": images are dragged
  await fileRow(editor, 'main.typ').click();
  await fileRow(editor, 'logo.svg').dragTo(editor.getByTestId('typst-visual').locator('p').first());
  await expect.poll(() => editor.evaluate((el: Editor) => el.value)).toContain('#image("logo.svg")');
  await expect(editor.getByTestId('typst-preview').locator('.typst-preview__page image')).toHaveCount(1);
});
