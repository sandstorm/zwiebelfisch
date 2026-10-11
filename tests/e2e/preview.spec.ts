// End-to-end tests (Playwright, against the demo build): the live preview and click-to-source.
import { expect } from '@playwright/test';
import { test, clickGlyph } from './fixtures';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('renders the Typst document in the preview', async ({ page }) => {
  const firstPage = page.getByTestId('typst-preview').locator('.typst-preview__page svg').first();
  await expect(firstPage).toBeVisible();
});

test('updates the preview while typing in the source editor', async ({ page }) => {
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
  // the first glyph on the page is the "T" of the heading "Typst in five minutes"
  await clickGlyph(svg.locator('use').first());
  await expect(page.getByTestId('typst-source').locator('.typst-source__jump')).toHaveText('Typst in five minutes');
});

test('clicking text in the preview selects exactly that text in the visual editor', async ({ page }) => {
  await expect(page.getByTestId('typst-visual')).toBeVisible();
  const svg = page.getByTestId('typst-preview').locator('.typst-preview__page svg').first();
  await expect(svg).toBeVisible();
  // the first glyph on the page is the "T" of the heading "Typst in five minutes"
  await clickGlyph(svg.locator('use').first());
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('Typst in five minutes');
});

test('shows compiler errors in the source and the status, and clears them when fixed', async ({ page }) => {
  const source = page.getByTestId('typst-source');
  const status = page.getByTestId('typst-status');
  const preview = page.getByTestId('typst-preview');
  await expect(status).toHaveText(/✓ compiled/);
  await page.getByRole('tab', { name: 'Source' }).click();
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
  await page.getByRole('tab', { name: 'Source' }).click();
  await source.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('\n#unknown');
  // from the Visual editor, which does not mark errors, the count switches to the Source editor
  await page.getByRole('tab', { name: 'Visual' }).click();
  await expect(source).toBeHidden();
  await page.getByTestId('typst-status').getByRole('button', { name: /1 error/ }).click();
  await expect(page.getByRole('tab', { name: 'Source' })).toHaveAttribute('aria-selected', 'true');
  await expect(source.locator('.typst-source__jump')).toHaveText('unknown');
});

test('hovering the error count lists the message; the Visual editor marks the error inline', async ({ page }) => {
  const source = page.getByTestId('typst-source');
  await page.getByRole('tab', { name: 'Source' }).click();
  await source.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('\n#unknown');
  await page.getByRole('tab', { name: 'Visual' }).click();
  const status = page.getByTestId('typst-status');
  await status.getByRole('button', { name: /1 error/ }).hover();
  await expect(status.locator('.typst-diagnostics__status-details')).toBeVisible();
  await expect(status.locator('.typst-diagnostics__status-details')).toContainText('unknown variable');
  await expect(page.getByTestId('typst-visual').locator('.typst-diagnostics__highlight[data-severity=error]')).toHaveCount(1);
  await expect(page.getByTestId('typst-visual').locator('.typst-diagnostics__highlight')).toHaveAttribute('title', /unknown variable/);
});
