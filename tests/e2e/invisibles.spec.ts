// End-to-end tests (Playwright, against the demo build): "Show invisibles" in the editor's tab bar shows the marks of
// spaces and paragraph ends in the Visual editor and the whitespace in the Source editor, is remembered, and changes
// neither the text nor what is copied.
import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';
import { compiled, sourceText, visual } from './visual-helpers';

const setSource = (page: Page, text: string) =>
  page.evaluate((t) => ((window as unknown as { editor: { source: string } }).editor.source = t), text);
const TEXT = 'One two  three\n\nA~B\n';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await compiled(page);
  await setSource(page, TEXT);
  await expect(visual(page)).toContainText('three');
});

test('shows the invisible characters in both editors, remembered, the text unchanged', async ({ page }) => {
  const button = (name: string) => page.getByRole('toolbar', { name: 'Editor actions' }).getByRole('button', { name });
  await expect(visual(page).locator('.typst-invisibles__space')).toHaveCount(0);
  await button('Show invisibles').click();
  await expect(visual(page).locator('.typst-invisibles__space')).toHaveCount(3);
  await expect(visual(page).locator('.typst-invisibles__nbsp')).toHaveCount(1);
  await expect(visual(page).locator('.typst-invisibles__paragraph')).toHaveCount(2);
  // drawn as CSS content: a muted dot over the space, not part of the text
  const dot = await visual(page).locator('.typst-invisibles__space').first().evaluate((el) => getComputedStyle(el, '::after').content);
  expect(dot).toBe('"·"');
  await expect.poll(sourceText(page)).toBe(TEXT);

  // copied text has no marks
  await visual(page).locator('p').first().click();
  await page.keyboard.press('ControlOrMeta+A');
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).not.toMatch(/[·¶°]/);

  await page.getByRole('tab', { name: 'Source' }).click();
  await expect(page.getByTestId('typst-source').locator('.cm-highlightSpace').first()).toBeVisible();

  await page.reload();
  await compiled(page);
  await setSource(page, TEXT);
  await page.getByRole('tab', { name: 'Visual' }).click();
  await expect(visual(page).locator('.typst-invisibles__space')).toHaveCount(3);
  await button('Hide invisibles').click();
  await expect(visual(page).locator('.typst-invisibles__space')).toHaveCount(0);
});

test('typing keeps the marks in step with the text', async ({ page }) => {
  await page.getByRole('toolbar', { name: 'Editor actions' }).getByRole('button', { name: 'Show invisibles' }).click();
  await visual(page).locator('p', { hasText: 'three' }).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' four five');
  await expect(visual(page).locator('.typst-invisibles__space')).toHaveCount(5);
  await page.keyboard.press('Enter');
  await expect(visual(page).locator('.typst-invisibles__paragraph')).toHaveCount(3);
});
