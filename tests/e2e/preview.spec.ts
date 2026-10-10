import { test, expect } from './fixtures';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('renders the Typst document in the preview', async ({ page }) => {
  const firstPage = page.getByTestId('typst-preview').locator('.typst-preview__page svg').first();
  await expect(firstPage).toBeVisible();
});

test('updates the preview while typing in the source view', async ({ page }) => {
  await page.getByRole('tab', { name: 'Source' }).click();
  const preview = page.getByTestId('typst-preview');
  await expect(preview.locator('.typst-preview__page')).toHaveCount(1);
  await page.getByTestId('typst-source').locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('\n#pagebreak()\nSecond page');
  await expect(preview.locator('.typst-preview__page')).toHaveCount(2);
});

test('clicking text in the preview selects its source', async ({ page }) => {
  await page.getByRole('tab', { name: 'Source' }).click();
  const svg = page.getByTestId('typst-preview').locator('.typst-preview__page svg').first();
  await expect(svg).toBeVisible();
  // the first glyph on the page is the "H" of the heading "Hello Typst"
  await svg.locator('use').first().click();
  await expect(page.getByTestId('typst-source').locator('.typst-source__jump')).toHaveText('Hello Typst');
});

test('shows compiler errors in the source and the status, and clears them when fixed', async ({ page }) => {
  const source = page.getByTestId('typst-source');
  const status = page.getByTestId('typst-status');
  const preview = page.getByTestId('typst-preview');
  await expect(status).toHaveText(/✓ compiled/);
  await source.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('\n#unknown');
  await expect(source.locator('.cm-lintRange-error')).toHaveCount(1);
  await expect(status).toHaveText(/1 error/);
  await expect(preview).toHaveClass(/typst-preview--stale/);

  await page.keyboard.press('Shift+Home');
  await page.keyboard.press('Backspace');
  await expect(source.locator('.cm-lintRange-error')).toHaveCount(0);
  await expect(status).toHaveText(/✓ compiled/);
  await expect(preview).not.toHaveClass(/typst-preview--stale/);
});

test('clicking the error count selects the first error in the source', async ({ page }) => {
  const source = page.getByTestId('typst-source');
  await source.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('\n#unknown');
  await page.getByTestId('typst-status').getByRole('button', { name: /1 error/ }).click();
  await expect(source.locator('.typst-source__jump')).toHaveText('unknown');
});
