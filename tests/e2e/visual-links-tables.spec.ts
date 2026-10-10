import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Formatting' });
const visual = (page: Page) => page.getByTestId('typst-visual');
/** The main file's text, from the demo's editor API (CodeMirror renders lines separately). */
const sourceText = (page: Page) => () => page.evaluate(() => (window as unknown as { editor: { source: string } }).editor.source);

/** Adds a new paragraph "Fresh line" after the first paragraph and selects it. */
async function freshSelectedLine(page: Page) {
  await visual(page).locator('p').first().click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Fresh line');
  await page.keyboard.press('Shift+Home');
}

test('Link button links the selection to the URL entered in its popover', async ({ page }) => {
  await freshSelectedLine(page);
  await toolbar(page).getByRole('button', { name: 'Link' }).click();
  const popover = page.getByRole('form', { name: 'Link' });
  await popover.getByLabel('URL').fill('https://typst.app');
  await popover.getByLabel('URL').press('Enter');
  await expect(popover).toBeHidden();
  await expect(visual(page).locator('a', { hasText: 'Fresh line' })).toHaveAttribute('href', 'https://typst.app');
  await expect.poll(sourceText(page)).toContain('#link("https://typst.app")[Fresh line]');
});

test('Mod+K opens the link popover; Remove unlinks', async ({ page }) => {
  await freshSelectedLine(page);
  await page.keyboard.press('ControlOrMeta+K');
  const popover = page.getByRole('form', { name: 'Link' });
  await popover.getByLabel('URL').fill('https://typst.app');
  await popover.getByRole('button', { name: 'Apply' }).click();
  await visual(page).locator('a', { hasText: 'Fresh line' }).click();
  await page.keyboard.press('ControlOrMeta+K');
  await popover.getByRole('button', { name: 'Remove' }).click();
  await expect(visual(page).locator('a', { hasText: 'Fresh line' })).toHaveCount(0);
  await expect.poll(sourceText(page)).not.toContain('#link(');
});

test('Insert image adds an #image block with the entered path', async ({ page }) => {
  await visual(page).locator('p').first().click();
  await page.keyboard.press('End');
  await toolbar(page).getByRole('button', { name: 'Insert image' }).click();
  const popover = page.getByRole('form', { name: 'Image' });
  await popover.getByLabel('Image path').fill('images/logo.png');
  await popover.getByLabel('Image path').press('Enter');
  await expect(visual(page).locator('.typst-visual__image-label')).toHaveText('Image: images/logo.png');
  await expect.poll(sourceText(page)).toContain('\n\n#image("images/logo.png")\n');
});

test('Insert table adds a 2x2 #table; typing into a cell fills it', async ({ page }) => {
  await visual(page).locator('p').first().click();
  await page.keyboard.press('End');
  await toolbar(page).getByRole('button', { name: 'Insert table' }).click();
  await expect(visual(page).locator('table td')).toHaveCount(4);
  await page.keyboard.type('Cell');
  await expect.poll(sourceText(page)).toContain('#table(\n  columns: 2,\n  [Cell], [],\n  [], [],\n)');
});

test('table buttons add and delete rows and columns', async ({ page }) => {
  await visual(page).locator('p').first().click();
  await page.keyboard.press('End');
  const bar = toolbar(page);
  await bar.getByRole('button', { name: 'Insert table' }).click();
  await bar.getByRole('button', { name: 'Add row' }).click();
  await expect.poll(sourceText(page)).toContain('  [], [],\n  [], [],\n  [], [],\n)');
  await bar.getByRole('button', { name: 'Add column' }).click();
  await expect.poll(sourceText(page)).toContain('columns: 3,');
  await bar.getByRole('button', { name: 'Delete column' }).click();
  await bar.getByRole('button', { name: 'Delete row' }).click();
  await expect.poll(sourceText(page)).toContain('#table(\n  columns: 2,\n  [], [],\n  [], [],\n)');
});

test('a table from the source is edited cell by cell', async ({ page }) => {
  await page.evaluate(() => {
    const editor = (window as unknown as { editor: { source: string } }).editor;
    editor.source = '#table(\n  columns: 2,\n  stroke: none,\n  [a], [b],\n)\n';
  });
  await visual(page).locator('td', { hasText: 'b' }).click();
  await page.keyboard.press('End');
  await page.keyboard.type('!');
  await expect.poll(sourceText(page)).toBe('#table(\n  columns: 2,\n  stroke: none,\n  [a], [b!],\n)\n');
});
