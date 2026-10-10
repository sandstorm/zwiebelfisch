import { test, expect } from './fixtures';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('shows the document in the visual view by default', async ({ page }) => {
  const visual = page.getByTestId('typst-visual');
  await expect(visual.locator('h1')).toHaveText('Hello Typst');
  await expect(visual.locator('strong')).toHaveText('bold');
  await expect(visual.locator('.typst-visual__raw-block').first()).toContainText('#set page');
});

test('typing in the visual view updates the Typst source', async ({ page }) => {
  const heading = page.getByTestId('typst-visual').locator('h1');
  await heading.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' World');
  await page.getByRole('tab', { name: 'Source' }).click();
  await expect(page.getByTestId('typst-source')).toContainText('= Hello Typst World');
});

test('bold via keyboard shortcut becomes *…* in the source', async ({ page }) => {
  const paragraph = page.getByTestId('typst-visual').locator('p').first();
  await paragraph.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' ');
  await page.keyboard.press('ControlOrMeta+b');
  await page.keyboard.type('new');
  await page.getByRole('tab', { name: 'Source' }).click();
  await expect(page.getByTestId('typst-source')).toContainText('source. *new*');
});

test('clicking the preview selects the block in the visual view', async ({ page }) => {
  const svg = page.getByTestId('typst-preview').locator('.typst-preview__page svg').first();
  await expect(svg).toBeVisible();
  await svg.locator('use').first().click();
  const selected = await page.evaluate(() => window.getSelection()?.toString());
  expect(selected).toBe('Hello Typst');
});
