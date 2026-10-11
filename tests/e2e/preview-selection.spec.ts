// End-to-end tests (Playwright, against the demo build): the selection of the Source and Visual editors shaded in the
// preview (preview-sync's `previewSync.highlightSelection`, the preview's `setSelectionHighlight`).
import { expect, type Page } from '@playwright/test';
import { test, clickGlyph } from './fixtures';
import { compiled, visual } from './visual-helpers';

const preview = (page: Page) => page.getByTestId('typst-preview');
const shading = (page: Page) => preview(page).locator('.typst-preview__selection');

/** Selects the line of the main file holding `text` in the Source editor (a short line: Home / End stop at wraps). */
async function selectLine(page: Page, text: string) {
  await page.getByTestId('typst-source').locator('.cm-line', { hasText: text }).first().click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await compiled(page);
});

test('shades the text selected in the Source editor, and nothing once the selection collapses', async ({ page }) => {
  await page.getByRole('tab', { name: 'Source' }).click();
  await selectLine(page, '= Typst in five minutes');
  await expect(shading(page).first()).toBeVisible();
  // in the preview's pages, translucent, over the text
  const box = (await shading(page).first().boundingBox())!;
  const pageBox = (await preview(page).locator('.typst-preview__page').first().boundingBox())!;
  expect(box.height).toBeLessThan(pageBox.height / 4);
  await page.keyboard.press('ArrowRight');
  await expect(shading(page)).toHaveCount(0);
});

test('shades the text selected in the Visual editor, and nothing once the selection collapses', async ({ page }) => {
  await page.getByRole('tab', { name: 'Visual' }).click();
  const heading = visual(page).locator('h1, h2').first();
  await heading.selectText();
  await expect(shading(page).first()).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(shading(page)).toHaveCount(0);
});

test('a click in the preview is outlined, not shaded too; selecting elsewhere shades that instead', async ({ page }) => {
  await page.getByRole('tab', { name: 'Source' }).click();
  await clickGlyph(preview(page).locator('.typst-preview__page svg use').first());
  await expect(preview(page).locator('.typst-preview__highlight').first()).toBeVisible();
  // give the shading its delay: it must stay away
  await page.waitForTimeout(300);
  await expect(shading(page)).toHaveCount(0);

  // the heading's line with its `= `: more than the click selected
  await selectLine(page, '= Typst in five minutes');
  await expect(preview(page).locator('.typst-preview__highlight')).toHaveCount(0);
  await expect(shading(page).first()).toBeVisible();
});
