import { test, expect } from './fixtures';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('renders the Typst document in the preview', async ({ page }) => {
  const firstPage = page.getByTestId('typst-preview').locator('.typst-preview__page svg').first();
  await expect(firstPage).toBeVisible();
});

test('updates the preview while typing in the source view', async ({ page }) => {
  const preview = page.getByTestId('typst-preview');
  await expect(preview.locator('.typst-preview__page')).toHaveCount(1);
  await page.getByTestId('typst-source').locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('\n#pagebreak()\nSecond page');
  await expect(preview.locator('.typst-preview__page')).toHaveCount(2);
});

test('clicking text in the preview selects its source', async ({ page }) => {
  const svg = page.getByTestId('typst-preview').locator('.typst-preview__page svg').first();
  await expect(svg).toBeVisible();
  // the first glyph on the page is the "H" of the heading "Hello Typst"
  await svg.locator('use').first().click();
  await expect(page.getByTestId('typst-source').locator('.typst-source__jump')).toHaveText('Hello Typst');
});
