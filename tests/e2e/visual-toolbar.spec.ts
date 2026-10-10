import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

/** Adds a new paragraph "Fresh line" after the first paragraph and selects it. */
async function freshSelectedLine(page: Page) {
  await page.getByTestId('typst-visual').locator('p').first().click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Fresh line');
  await page.keyboard.press('Shift+Home');
}

async function source(page: Page) {
  await page.getByRole('tab', { name: 'Source' }).click();
  return page.getByTestId('typst-source');
}

const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Formatting' });

test('Bold button wraps the selection in *…*', async ({ page }) => {
  await freshSelectedLine(page);
  await toolbar(page).getByRole('button', { name: 'Bold' }).click();
  await expect(toolbar(page).getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true');
  await expect(await source(page)).toContainText('*Fresh line*');
});

test('Italic button wraps the selection in _…_', async ({ page }) => {
  await freshSelectedLine(page);
  await toolbar(page).getByRole('button', { name: 'Italic' }).click();
  await expect(await source(page)).toContainText('_Fresh line_');
});

for (const [label, prefix] of [['Heading 1', '= '], ['Heading 2', '== '], ['Heading 3', '=== ']] as const) {
  test(`text style "${label}" makes the line a ${prefix.trim()} heading`, async ({ page }) => {
    await freshSelectedLine(page);
    await toolbar(page).getByLabel('Text style').selectOption({ label });
    await expect(await source(page)).toContainText(`${prefix}Fresh line`);
  });
}

test('text style "Normal text" turns a heading back into a paragraph', async ({ page }) => {
  await page.getByTestId('typst-visual').locator('h1').click();
  await toolbar(page).getByLabel('Text style').selectOption({ label: 'Normal text' });
  const src = await source(page);
  await expect(src).not.toContainText('= Hello Typst');
  await expect(src).toContainText('Hello Typst');
});

test('Bulleted list button makes a - item', async ({ page }) => {
  await freshSelectedLine(page);
  await toolbar(page).getByRole('button', { name: 'Bulleted list' }).click();
  await expect(await source(page)).toContainText('- Fresh line');
});

test('Numbered list button makes a + item', async ({ page }) => {
  await freshSelectedLine(page);
  await toolbar(page).getByRole('button', { name: 'Numbered list' }).click();
  await expect(await source(page)).toContainText('+ Fresh line');
});

test('Undo and Redo buttons revert and reapply an edit', async ({ page }) => {
  await freshSelectedLine(page);
  const bar = toolbar(page);
  await bar.getByRole('button', { name: 'Bold' }).click();
  await bar.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('typst-visual').locator('strong', { hasText: 'Fresh line' })).toHaveCount(0);
  await bar.getByRole('button', { name: 'Redo' }).click();
  await expect(await source(page)).toContainText('*Fresh line*');
});

test('raw blocks are editable in place and change only their source', async ({ page }) => {
  const box = page.getByTestId('typst-visual').locator('.typst-visual__raw-block').first();
  await box.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+Home');
  await page.keyboard.press('End');
  await page.keyboard.type('\n#set par(justify: true)');
  // CodeMirror renders lines as separate elements, so read the source text from the demo's editor API
  const text = () => page.evaluate(() => (window as unknown as { editor: { source: string } }).editor.source);
  await expect.poll(text).toContain('margin: 1.5cm)\n#set par(justify: true)\n#set text');
});

test('arrow down on the last line of a raw block moves into the next block', async ({ page }) => {
  const visual = page.getByTestId('typst-visual');
  await visual.locator('.typst-visual__raw-block').first().locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+Home');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.type('X');
  await expect(visual.locator('h1')).toHaveText('XHello Typst');
});
