// End-to-end tests (Playwright, against the demo build): links and tables in the Visual editor.
import { expect } from '@playwright/test';
import { test } from './fixtures';
import { caretAtEnd, chooseFrom, compiled, freshSelectedLine, selectionBar, sourceText, tableBar, toolbar, visual } from './visual-helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await compiled(page);
});

test('Link button links the selection to the URL entered in the input box', async ({ page }) => {
  await freshSelectedLine(page);
  await selectionBar(page).getByRole('button', { name: 'Link' }).click();
  const input = page.getByRole('form', { name: 'Link' });
  await input.getByLabel('URL').fill('https://typst.app');
  await input.getByLabel('URL').press('Enter');
  await expect(input).toBeHidden();
  await expect(visual(page).locator('a', { hasText: 'Fresh line' })).toHaveAttribute('href', 'https://typst.app');
  await expect.poll(sourceText(page)).toContain('#link("https://typst.app")[Fresh line]');
});

test('Mod+K asks for the URL; an empty one unlinks', async ({ page }) => {
  await freshSelectedLine(page);
  await page.keyboard.press('ControlOrMeta+K');
  const input = page.getByRole('form', { name: 'Link' });
  await input.getByLabel('URL').fill('https://typst.app');
  await input.getByRole('button', { name: 'OK' }).click();
  await visual(page).locator('a', { hasText: 'Fresh line' }).click();
  await page.keyboard.press('ControlOrMeta+K');
  await expect(input.getByLabel('URL (empty removes the link)')).toHaveValue('https://typst.app');
  await input.getByLabel('URL (empty removes the link)').fill('');
  await input.getByLabel('URL (empty removes the link)').press('Enter');
  await expect(visual(page).locator('a', { hasText: 'Fresh line' })).toHaveCount(0);
  await expect.poll(sourceText(page)).not.toContain('#link(');
});

test('Insert image adds an #image block with the entered path', async ({ page }) => {
  await caretAtEnd(visual(page).locator('p').first());
  await chooseFrom(toolbar(page), 'Insert', 'Insert image');
  await page.getByRole('dialog', { name: 'Insert image' }).getByRole('option', { name: 'Enter a path…' }).click();
  const input = page.getByRole('form', { name: 'Insert image' });
  await input.getByLabel('Image path').fill('images/logo.png');
  await input.getByLabel('Image path').press('Enter');
  await expect(visual(page).locator('.typst-images__label')).toHaveText('Image: images/logo.png');
  await expect.poll(sourceText(page)).toContain('\n\n#image("images/logo.png")\n');
});

test('Insert table adds a 2x2 #table; typing into a cell fills it', async ({ page }) => {
  await caretAtEnd(visual(page).locator('p').first());
  await chooseFrom(toolbar(page), 'Insert', 'Insert table');
  await expect(visual(page).locator('table td')).toHaveCount(4);
  await page.keyboard.type('Cell');
  await expect.poll(sourceText(page)).toContain('#table(\n  columns: 2,\n  [Cell], [],\n  [], [],\n)');
});

test('table buttons add and delete rows and columns', async ({ page }) => {
  await caretAtEnd(visual(page).locator('p').first());
  await chooseFrom(toolbar(page), 'Insert', 'Insert table');
  const bar = tableBar(page); // floats above the table while the cursor is in it
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
  await caretAtEnd(visual(page).locator('td', { hasText: 'b' }).locator('p'));
  await page.keyboard.type('!');
  await expect.poll(sourceText(page)).toBe('#table(\n  columns: 2,\n  stroke: none,\n  [a], [b!],\n)\n');
});
