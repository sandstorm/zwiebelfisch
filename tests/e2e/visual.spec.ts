// End-to-end tests (Playwright, against the demo build): the Visual editor.
import { expect } from '@playwright/test';
import { test } from './fixtures';
import { caretAtEnd, clickFirstGlyph, compiled, visual } from './visual-helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await compiled(page);
});

test('shows the document in the visual editor by default', async ({ page }) => {
  await expect(visual(page).locator('h1')).toHaveText('Typst in five minutes');
  await expect(visual(page).locator('strong').first()).toHaveText('stars');
  await expect(visual(page).locator('.zwf-visual__raw-block').first()).toContainText('#set page');
});

test('typing in the visual editor updates the Typst source', async ({ page }) => {
  await caretAtEnd(visual(page).locator('h1'));
  await page.keyboard.type(' World');
  await page.getByRole('tab', { name: 'Source' }).click();
  await expect(page.getByTestId('zwf-source')).toContainText('= Typst in five minutes World');
});

test('bold via keyboard shortcut becomes *…* in the source', async ({ page }) => {
  await caretAtEnd(visual(page).locator('p').first());
  await page.keyboard.type(' ');
  await page.keyboard.press('ControlOrMeta+b');
  await page.keyboard.type('new');
  await page.getByRole('tab', { name: 'Source' }).click();
  await expect(page.getByTestId('zwf-source')).toContainText('code. *new*');
});

test('Mod-i makes typed text italic instead of triggering a browser shortcut', async ({ page }) => {
  await caretAtEnd(visual(page).locator('p').first());
  await page.keyboard.type(' ');
  await page.keyboard.press('ControlOrMeta+i');
  await page.keyboard.type('slanted');
  await expect(visual(page).locator('em', { hasText: 'slanted' })).toBeVisible();
});

test('typing shortcuts follow Typst: "== " starts a heading, *…* is bold, _…_ italic', async ({ page }) => {
  await caretAtEnd(visual(page).locator('p').first());
  await page.keyboard.press('Enter');
  await page.keyboard.type('== Section');
  await expect(visual(page).locator('h2', { hasText: 'Section' })).toBeVisible();
  await page.keyboard.press('Enter');
  await page.keyboard.type('A *bold* and _slanted_ word');
  await expect(visual(page).locator('strong', { hasText: 'bold' })).toBeVisible();
  await expect(visual(page).locator('em', { hasText: 'slanted' })).toBeVisible();
  await page.getByRole('tab', { name: 'Source' }).click();
  await expect(page.getByTestId('zwf-source')).toContainText('== Section');
  await expect(page.getByTestId('zwf-source')).toContainText('A *bold* and _slanted_ word');
});

test('Markdown\'s "## " still starts a heading', async ({ page }) => {
  await caretAtEnd(visual(page).locator('p').first());
  await page.keyboard.press('Enter');
  await page.keyboard.type('## Section');
  await page.getByRole('tab', { name: 'Source' }).click();
  await expect(page.getByTestId('zwf-source')).toContainText('== Section');
});

test('clicking the preview selects the block in the visual editor', async ({ page }) => {
  await clickFirstGlyph(page);
  // the jump arrives asynchronously from the engine worker
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('Typst in five minutes');
});
