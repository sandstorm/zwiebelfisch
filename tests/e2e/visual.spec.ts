import { test, expect } from './fixtures';
import { caretAtEnd, clickFirstGlyph, compiled, visual } from './visual-helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await compiled(page);
});

test('shows the document in the visual view by default', async ({ page }) => {
  await expect(visual(page).locator('h1')).toHaveText('Hello Typst');
  await expect(visual(page).locator('strong')).toHaveText('bold');
  await expect(visual(page).locator('.typst-visual__raw-block').first()).toContainText('#set page');
});

test('typing in the visual view updates the Typst source', async ({ page }) => {
  await caretAtEnd(visual(page).locator('h1'));
  await page.keyboard.type(' World');
  await page.getByRole('tab', { name: 'Source' }).click();
  await expect(page.getByTestId('typst-source')).toContainText('= Hello Typst World');
});

test('bold via keyboard shortcut becomes *…* in the source', async ({ page }) => {
  await caretAtEnd(visual(page).locator('p').first());
  await page.keyboard.type(' ');
  await page.keyboard.press('ControlOrMeta+b');
  await page.keyboard.type('new');
  await page.getByRole('tab', { name: 'Source' }).click();
  await expect(page.getByTestId('typst-source')).toContainText('source. *new*');
});

test('Mod-i makes typed text italic instead of triggering a browser shortcut', async ({ page }) => {
  await caretAtEnd(visual(page).locator('p').first());
  await page.keyboard.type(' ');
  await page.keyboard.press('ControlOrMeta+i');
  await page.keyboard.type('slanted');
  await expect(visual(page).locator('em', { hasText: 'slanted' })).toBeVisible();
});

test('markdown-style input rules: "## " starts a heading', async ({ page }) => {
  await caretAtEnd(visual(page).locator('p').first());
  await page.keyboard.press('Enter');
  await page.keyboard.type('## Section');
  await page.getByRole('tab', { name: 'Source' }).click();
  await expect(page.getByTestId('typst-source')).toContainText('== Section');
});

test('clicking the preview selects the block in the visual view', async ({ page }) => {
  await clickFirstGlyph(page);
  // the jump arrives asynchronously from the engine worker
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('Hello Typst');
});
