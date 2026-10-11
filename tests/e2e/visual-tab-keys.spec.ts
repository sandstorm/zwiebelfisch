// End-to-end tests (Playwright, against the demo build): Tab and Shift+Tab stay in the Visual editor; Escape, then Tab leaves it.
import { test } from './fixtures';
import { expect, type Page } from '@playwright/test';
import { caretAtEnd, compiled, sourceText, visual } from './visual-helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await compiled(page);
});

/** Whether the focus is in the Visual editor's text. */
const focusedInText = (page: Page) =>
  visual(page).evaluate((element) => {
    const root = element.getRootNode() as Document | ShadowRoot;
    return element.contains(root.activeElement);
  });

test('Tab and Shift+Tab in a paragraph keep the focus in the text and change nothing', async ({ page }) => {
  await caretAtEnd(visual(page).locator('p').first());
  const before = await sourceText(page)();
  await page.keyboard.press('Tab');
  expect(await focusedInText(page)).toBe(true);
  await page.keyboard.press('Shift+Tab');
  expect(await focusedInText(page)).toBe(true);
  expect(await sourceText(page)()).toBe(before);
});

test('Escape, then Tab moves the focus on, out of the text', async ({ page }) => {
  await caretAtEnd(visual(page).locator('p').first());
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');
  expect(await focusedInText(page)).toBe(false);
});

test('Tab in a list item nests it, the focus stays', async ({ page }) => {
  await caretAtEnd(visual(page).locator('p').first());
  await page.keyboard.press('Enter');
  await page.keyboard.type('- one');
  await page.keyboard.press('Enter');
  await page.keyboard.type('two');
  await page.keyboard.press('Tab');
  expect(await focusedInText(page)).toBe(true);
  await expect.poll(sourceText(page)).toContain('- one\n  - two');
});
