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

test('Mod-i makes typed text italic instead of triggering a browser shortcut', async ({ page }) => {
  const paragraph = page.getByTestId('typst-visual').locator('p').first();
  await paragraph.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' ');
  await page.keyboard.press('ControlOrMeta+i');
  await page.keyboard.type('slanted');
  await expect(page.getByTestId('typst-visual').locator('em', { hasText: 'slanted' })).toBeVisible();
});

test('markdown-style input rules: "## " starts a heading', async ({ page }) => {
  const paragraph = page.getByTestId('typst-visual').locator('p').first();
  await paragraph.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('## Section');
  await page.getByRole('tab', { name: 'Source' }).click();
  await expect(page.getByTestId('typst-source')).toContainText('== Section');
});

test('clicking the preview selects the block in the visual view', async ({ page }) => {
  const svg = page.getByTestId('typst-preview').locator('.typst-preview__page svg').first();
  await expect(svg).toBeVisible();
  await svg.locator('use').first().click();
  // the jump arrives asynchronously from the engine worker
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('Hello Typst');
});
